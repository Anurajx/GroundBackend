/**
 * Delhi Buses PIS-GTFS Stop Reconciliation Pipeline (Highly Optimized Direction-Aware Version)
 * 
 * This script extracts online stop mapping details and direction information (nextstopnames)
 * from a Passenger Information System (PIS) page, normalizes names, and reconciles them
 * with the static GTFS stops.
 * 
 * It runs a GTFS-centric reconciliation matching each static GTFS stop with the best PIS entry.
 * It resolves direction conflicts using next-stop validation and enforces a strict 1-to-1 mapping
 * via a greedy bipartite matching algorithm.
 * 
 * Performance: Optimized with exact-match indexing, word-sharing pruning, and transaction-based SQLite updates.
 * 
 * Usage: node reconcile.js
 */

const fs = require('fs');
const path = require('path');

// 1. PATH CONFIGURATIONS
const PIS_FILE_PATH = path.join(__dirname, '../pis.txt');
const STOPS_TXT_PATH = path.join(__dirname, '../../delhi_buses_static_gtfs_v1 (1)/stops.txt');
const SQLITE_DB_PATH = path.join(__dirname, '../../assets/routes.db');
const OUTPUT_JSON_PATH = path.join(__dirname, 'reconciled_stops.json');
const OUTPUT_UNRESOLVED_JSON_PATH = path.join(__dirname, 'unresolved_stops.json');
const OUTPUT_SQL_PATH = path.join(__dirname, 'cross_reference_insert.sql');

// 2. EXTRACTION PARSING ENGINE
function parsePisFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PIS input file not found at: ${filePath}`);
  }
  
  console.log(`[Step 1] Reading PIS source file: ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf8');

  const stopNames = [];
  const stopIds = [];
  const nextStopNames = [];

  // Match stopnames.push(("Stop Name")) or stopnames.push("Stop Name")
  const nameRegex = /\bstopnames\.push\(\s*(?:\(\s*)?['"](.*?)['"](?:\s*\))?\s*\)/g;
  let match;
  while ((match = nameRegex.exec(content)) !== null) {
    stopNames.push(match[1]);
  }

  // Match stopid.push(1234)
  const idRegex = /\bstopid\.push\(\s*(\d+)\s*\)/g;
  while ((match = idRegex.exec(content)) !== null) {
    stopIds.push(parseInt(match[1], 10));
  }

  // Match nextstopnames.push(("Towards Next Stop Name")) or nextstopnames.push("Towards Next Stop Name")
  const nextRegex = /\bnextstopnames\.push\(\s*(?:\(\s*)?['"](.*?)['"](?:\s*\))?\s*\)/g;
  while ((match = nextRegex.exec(content)) !== null) {
    nextStopNames.push(match[1]);
  }

  console.log(`Successfully parsed ${stopNames.length} names, ${nextStopNames.length} next names, and ${stopIds.length} IDs.`);
  
  if (stopNames.length !== stopIds.length || stopNames.length !== nextStopNames.length) {
    console.warn(`[WARNING] Parser count mismatch! stopNames: ${stopNames.length}, nextStopNames: ${nextStopNames.length}, stopIds: ${stopIds.length}`);
  }

  const tuples = [];
  const minLength = Math.min(stopNames.length, stopIds.length, nextStopNames.length);
  for (let i = 0; i < minLength; i++) {
    const rawNext = nextStopNames[i] ? nextStopNames[i].trim() : '';
    let cleanedNext = rawNext;
    
    if (cleanedNext.toLowerCase().startsWith('towards ')) {
      cleanedNext = cleanedNext.substring(8).trim();
    }
    
    cleanedNext = cleanedNext
      .replace(/&amp;/g, 'and')
      .replace(/&#\d+;/g, '')
      .replace(/&quot;/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    tuples.push({
      pis_id: stopIds[i],
      pis_name: stopNames[i],
      pis_next_raw: rawNext,
      pis_next_name: cleanedNext
    });
  }
  return tuples;
}

// 3. AGGRESSIVE TEXT NORMALIZATION
function normalizeStopName(name) {
  if (!name) return '';
  let str = name.toLowerCase();

  str = str.replace(/&amp;/g, 'and')
           .replace(/&#\d+;/g, '')
           .replace(/&quot;/g, '')
           .replace(/&lt;/g, '<')
           .replace(/&gt;/g, '>')
           .trim();

  const replacements = [
    { regex: /\bsec(\b|\d)/g, replacement: 'sector$1' },
    { regex: /\bpkt(\b|\d)/g, replacement: 'pocket$1' },
    { regex: /\bterm\b/g, replacement: 'terminal' },
    { regex: /\bmtr\b/g, replacement: 'metro' },
    { regex: /\bstn\b/g, replacement: 'station' },
    { regex: /\bx-ing\b|\bxing\b/g, replacement: 'crossing' },
    { regex: /\brd\b/g, replacement: 'road' },
    { regex: /\baptt?\b/g, replacement: 'apartment' },
    { regex: /\bencl\b/g, replacement: 'enclave' },
    { regex: /\bdept?\b/g, replacement: 'depot' },
    { regex: /\bhosp\b/g, replacement: 'hospital' }
  ];

  for (const r of replacements) {
    str = str.replace(r.regex, r.replacement);
  }

  str = str.replace(/[^a-z0-9]/g, '');

  return str;
}

// 3.5. WORD TOKENIZATION
function getNormalizedWords(name) {
  if (!name) return [];
  let cleaned = name.replace(/[-/()]/g, ' ');
  const rawWords = cleaned.split(/\s+/);
  const words = [];
  for (const rw of rawWords) {
    const normWord = normalizeStopName(rw);
    if (normWord) {
      words.push(normWord);
    }
  }
  return words;
}

// 4. FUZZY MATCHING LAYER (LEVENSHTEIN METRIC)
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array(a.length + 1);
  let currRow = Array(a.length + 1);

  for (let i = 0; i <= a.length; i++) {
    prevRow[i] = i;
  }

  for (let j = 1; j <= b.length; j++) {
    currRow[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        currRow[i - 1] + 1, // insertion
        prevRow[i] + 1,    // deletion
        prevRow[i - 1] + cost // substitution
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[a.length];
}

function calculateSimilarity(a, b) {
  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0;
  return 1.0 - distance / maxLength;
}

// 5. STATIC STOP LOADERS
function parseStopsFromTxt(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`GTFS stops.txt file not found at: ${filePath}`);
  }

  console.log(`[Step 2] Loading static stops from GTFS stops.txt: ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const headers = lines[0].split(',');
  const nameIndex = headers.indexOf('stop_name');
  const idIndex = headers.indexOf('stop_id');

  if (nameIndex === -1 || idIndex === -1) {
    throw new Error("Could not find stop_name or stop_id in stops.txt headers");
  }

  const stops = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const cells = [];
    let inQuotes = false;
    let currentCell = '';
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(currentCell.trim());
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    cells.push(currentCell.trim());

    if (cells.length > Math.max(nameIndex, idIndex)) {
      stops.push({
        stop_id: cells[idIndex],
        stop_name: cells[nameIndex],
        next_stop_name: null
      });
    }
  }

  return stops;
}

async function loadStopsFromSqlite(dbPath) {
  return new Promise((resolve, reject) => {
    try {
      const sqlite3 = require('sqlite3').verbose();
      console.log(`[Step 2] Opening SQLite database: ${dbPath}`);
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) return reject(err);
      });

      db.all(`
        SELECT 
          s.stop_id, 
          s.stop_name, 
          next_s.stop_name AS next_stop_name
        FROM stops s
        LEFT JOIN stop_times st1 ON s.stop_id = st1.stop_id
        LEFT JOIN stop_times st2 ON st1.trip_id = st2.trip_id AND st2.stop_sequence = st1.stop_sequence + 1
        LEFT JOIN stops next_s ON st2.stop_id = next_s.stop_id
        GROUP BY s.stop_id, next_s.stop_name;
      `, [], (err, rows) => {
        db.close();
        if (err) return reject(err);
        resolve(rows);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// 6. SQLITE UPDATER ENGINE (adds 'online_stop_id' column and syncs PIS IDs using high-speed transactions)
async function updateSqliteDatabase(dbPath, matches) {
  return new Promise((resolve, reject) => {
    try {
      const sqlite3 = require('sqlite3').verbose();
      console.log(`[Step 5] Writing matched data back to SQLite database stops table...`);
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) return reject(err);
      });

      db.serialize(() => {
        db.run("ALTER TABLE stops ADD COLUMN online_stop_id TEXT", (err) => {
          if (err) {
            if (err.message.includes("duplicate column name") || err.message.includes("already exists")) {
              // Ignore
            } else {
              console.warn("Could not ALTER TABLE stops: " + err.message);
            }
          }
        });

        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("UPDATE stops SET online_stop_id = ? WHERE stop_id = ?");
        let updatedCount = 0;

        for (const match of matches) {
          stmt.run(match.realtime_stop_id.toString(), match.static_stop_id.toString());
          updatedCount++;
        }

        stmt.finalize();
        db.run("COMMIT", (commitErr) => {
          db.close();
          if (commitErr) return reject(commitErr);
          console.log(`Successfully updated ${updatedCount} records in the SQLite database stops table.`);
          resolve();
        });
      });
    } catch (e) {
      reject(e);
    }
  });
}

// 6.5. AGGRESSIVE SCORING HELPER (Using Pre-computed Parts)
function getPartSimilarityScore(sp, pp, confidenceThreshold) {
  const norm1 = sp.norm;
  const norm2 = pp.norm;
  if (!norm1 || !norm2) return { similarity: 0.0, status: 'UNRESOLVED' };

  // Level 1: Exact Normalized Match
  if (norm1 === norm2) {
    return { similarity: 1.0, status: 'MATCHED' };
  }

  // Level 1.5: Word-based Sub-sequence Match
  const words1 = sp.words;
  const words2 = pp.words;
  if (words1.length >= 2 && words2.length >= 2) {
    const N = words1.length;
    const M = words2.length;
    const minLen = Math.min(N, M);

    // 1. Starting match check
    let kStart = 0;
    while (kStart < minLen && words1[kStart] === words2[kStart]) {
      kStart++;
    }
    if (kStart > 0) {
      const meetsRatio = kStart / N >= 2 / 3;
      const meetsPisEmpty = N - kStart <= 2;
      const meetsStaticEmpty = M - kStart <= 2;
      if (meetsRatio && meetsPisEmpty && meetsStaticEmpty) {
        return { similarity: kStart / Math.max(N, M), status: 'WORD_MATCHED' };
      }
    }

    // 2. Ending match check
    let kEnd = 0;
    while (kEnd < minLen && words1[N - 1 - kEnd] === words2[M - 1 - kEnd]) {
      kEnd++;
    }
    if (kEnd > 0) {
      const meetsRatio = kEnd / N >= 2 / 3;
      const meetsPisEmpty = N - kEnd <= 1;
      const meetsStaticEmpty = M - kEnd <= 1;
      if (meetsRatio && meetsPisEmpty && meetsStaticEmpty) {
        return { similarity: kEnd / Math.max(N, M), status: 'WORD_MATCHED' };
      }
    }
  }

  // Length pruning
  const lenDiff = Math.abs(norm1.length - norm2.length);
  const maxLength = Math.max(norm1.length, norm2.length);
  if (maxLength > 0 && (1.0 - lenDiff / maxLength) < confidenceThreshold) {
    return { similarity: 0.0, status: 'UNRESOLVED' };
  }

  // Level 2: Fuzzy Matching Levenshtein Fallback
  const sim = calculateSimilarity(norm1, norm2);
  if (sim >= confidenceThreshold) {
    return { similarity: sim, status: 'FUZZY_MATCHED' };
  }

  return { similarity: sim, status: 'UNRESOLVED' };
}

function precomputeParts(name) {
  const parts = name.includes('/') ? name.split('/') : [name];
  return parts.map(p => {
    const raw = p.trim();
    return {
      raw: raw,
      norm: normalizeStopName(raw),
      words: getNormalizedWords(raw)
    };
  });
}

// 7. PIPELINE COORDINATOR
async function runReconciliation() {
  console.log("====================================================");
  console.log("  Transit PIS-GTFS Stop Reconciliation Pipeline     ");
  console.log("====================================================\n");

  let parsedPistup;
  try {
    parsedPistup = parsePisFile(PIS_FILE_PATH);
  } catch (e) {
    console.error(`Fatal Parsing Error: ${e.message}`);
    process.exit(1);
  }

  // Determine static stops source (SQLite DB vs stops.txt fallback)
  let rawStops = [];
  let sqliteAvailable = false;
  
  try {
    rawStops = await loadStopsFromSqlite(SQLITE_DB_PATH);
    sqliteAvailable = true;
    console.log(`Loaded ${rawStops.length} static stops query rows from SQLite routes.db.`);
  } catch (e) {
    console.log(`SQLite load failed/not configured: ${e.message}`);
    console.log(`Falling back to static stops parsing from stops.txt.`);
    try {
      rawStops = parseStopsFromTxt(STOPS_TXT_PATH);
      console.log(`Loaded ${rawStops.length} static stops from GTFS stops.txt.`);
    } catch (txtError) {
      console.error(`Fatal GTFS stops load error: ${txtError.message}`);
      process.exit(1);
    }
  }

  const stopsMap = new Map();
  for (const row of rawStops) {
    if (!stopsMap.has(row.stop_id)) {
      stopsMap.set(row.stop_id, {
        stop_id: row.stop_id,
        stop_name: row.stop_name,
        next_stops: []
      });
    }
    if (row.next_stop_name) {
      stopsMap.get(row.stop_id).next_stops.push(row.next_stop_name);
    }
  }
  const aggregatedStops = Array.from(stopsMap.values());
  console.log(`Aggregated into ${aggregatedStops.length} unique static stops.`);

  console.log("\n[Step 3] Running GTFS Reconciliation Engine (Direction-Aware & Greedy 1-to-1 Mapping)...");
  
  // Index PIS entries by normalized part names
  console.log(" - Indexing PIS stop text attributes...");
  const pisMap = new Map();
  for (const p of parsedPistup) {
    p.precomputed_parts = precomputeParts(p.pis_name);
    p.norm_next_name = normalizeStopName(p.pis_next_name);
    for (const part of p.precomputed_parts) {
      if (part.norm) {
        if (!pisMap.has(part.norm)) {
          pisMap.set(part.norm, []);
        }
        pisMap.get(part.norm).push(p);
      }
    }
  }

  // Pre-compute static stops
  console.log(" - Pre-computing static stop text attributes...");
  for (const s of aggregatedStops) {
    s.precomputed_parts = precomputeParts(s.stop_name);
    s.norm_next_stops = s.next_stops.map(ns => normalizeStopName(ns)).filter(Boolean);
  }

  const confidenceThreshold = 0.82;
  const candidates = [];

  console.log(" - Matching and checking directions...");
  
  // Score candidates
  for (const s of aggregatedStops) {
    // 1. Look for exact matches in the indexed PIS map first
    let matchedPisEntries = [];
    for (const sp of s.precomputed_parts) {
      if (sp.norm && pisMap.has(sp.norm)) {
        matchedPisEntries.push(...pisMap.get(sp.norm));
      }
    }

    // Deduplicate exact match entries
    if (matchedPisEntries.length > 0) {
      matchedPisEntries = Array.from(new Set(matchedPisEntries));
    }

    // 2. If no exact match, do fallback word-sharing fuzzy comparison
    if (matchedPisEntries.length === 0) {
      for (const p of parsedPistup) {
        let maxSim = 0.0;
        let bestStatus = 'UNRESOLVED';

        for (const sp of s.precomputed_parts) {
          for (const pp of p.precomputed_parts) {
            // Pruning: skip if they share no normalized words
            const sharesWord = sp.words.some(w => pp.words.includes(w));
            if (!sharesWord) continue;

            const res = getPartSimilarityScore(sp, pp, confidenceThreshold);
            if (res.similarity > maxSim) {
              maxSim = res.similarity;
              bestStatus = res.status;
            }
          }
        }

        if (bestStatus !== 'UNRESOLVED') {
          matchedPisEntries.push({ entry: p, maxSim, bestStatus });
        }
      }
    } else {
      // Map exact matches to scoring format
      matchedPisEntries = matchedPisEntries.map(p => ({
        entry: p,
        maxSim: 1.0,
        bestStatus: 'MATCHED'
      }));
    }

    // 3. Process matched candidate entries for direction and scoring
    for (const matchObj of matchedPisEntries) {
      const p = matchObj.entry;
      const baseSim = matchObj.maxSim;
      const status = matchObj.bestStatus;
      
      let directionMatched = false;
      if (p.norm_next_name) {
        for (const normNS of s.norm_next_stops) {
          if (p.norm_next_name === normNS || calculateSimilarity(p.norm_next_name, normNS) >= 0.8) {
            directionMatched = true;
            break;
          }
        }
      }

      const score = baseSim + (directionMatched ? 1.0 : 0.0);

      candidates.push({
        static_stop_id: s.stop_id,
        static_stop_name: s.stop_name,
        realtime_stop_id: p.pis_id,
        realtime_stop_name: p.pis_name,
        realtime_next_stop_name: p.pis_next_raw,
        similarity: baseSim,
        status: status,
        directionMatched: directionMatched,
        score: score
      });
    }
  }

  console.log(` - Generated ${candidates.length} potential matching pairs. Sorting and filtering...`);

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Greedy bipartite matching
  const matchedStaticIds = new Set();
  const matchedRealtimeIds = new Set();
  const results = [];

  let directMatches = 0;
  let wordMatches = 0;
  let fuzzyMatches = 0;
  let dirMatchesCount = 0;

  for (const cand of candidates) {
    if (!matchedStaticIds.has(cand.static_stop_id) && !matchedRealtimeIds.has(cand.realtime_stop_id)) {
      matchedStaticIds.add(cand.static_stop_id);
      matchedRealtimeIds.add(cand.realtime_stop_id);
      
      results.push({
        static_stop_id: cand.static_stop_id,
        static_stop_name: cand.static_stop_name,
        realtime_stop_id: cand.realtime_stop_id,
        realtime_stop_name: cand.realtime_stop_name,
        realtime_next_stop_name: cand.realtime_next_stop_name,
        similarity: cand.similarity,
        status: cand.status
      });

      if (cand.directionMatched) dirMatchesCount++;
      if (cand.status === 'MATCHED') directMatches++;
      else if (cand.status === 'WORD_MATCHED') wordMatches++;
      else if (cand.status === 'FUZZY_MATCHED') fuzzyMatches++;
    }
  }

  const unresolvedStops = aggregatedStops
    .filter(s => !matchedStaticIds.has(s.stop_id))
    .map(s => ({
      static_stop_id: s.stop_id,
      static_stop_name: s.stop_name,
      next_stops: s.next_stops,
      status: 'UNRESOLVED_OVERRIDE'
    }));

  console.log(`Reconciliation results:`);
  console.log(` - Direct Matches: ${directMatches}`);
  console.log(` - Word-Sequence Matches: ${wordMatches}`);
  console.log(` - Levenshtein Fuzzy Matches: ${fuzzyMatches}`);
  console.log(` - Directionally Validated: ${dirMatchesCount}`);
  console.log(` - Total Matched GTFS Stops: ${results.length}`);
  console.log(` - Unresolved GTFS Stops: ${unresolvedStops.length}`);

  if (sqliteAvailable) {
    try {
      await updateSqliteDatabase(SQLITE_DB_PATH, results);
    } catch (dbErr) {
      console.warn(`[WARNING] Failed to write matches back to SQLite DB: ${dbErr.message}`);
    }
  }

  console.log(`\n[Step 6] Saving matched results JSON to: ${OUTPUT_JSON_PATH}`);
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(results, null, 2), 'utf8');

  console.log(`[Step 6b] Saving unresolved results JSON to: ${OUTPUT_UNRESOLVED_JSON_PATH}`);
  fs.writeFileSync(OUTPUT_UNRESOLVED_JSON_PATH, JSON.stringify(unresolvedStops, null, 2), 'utf8');

  console.log(`[Step 7] Generating PostgreSQL insert script to: ${OUTPUT_SQL_PATH}`);
  let sqlContent = `--- PostgreSQL PIS-GTFS Cross Reference Mapping Script
--- Generated: ${new Date().toISOString()}

CREATE TABLE IF NOT EXISTS stop_realtime_mapping (
    realtime_stop_id VARCHAR(50) PRIMARY KEY,
    static_stop_id VARCHAR(50) NOT NULL
);

TRUNCATE TABLE stop_realtime_mapping;

INSERT INTO stop_realtime_mapping (realtime_stop_id, static_stop_id) VALUES
`;

  const sqlInserts = [];
  for (const match of results) {
    const escapedRealtimeId = match.realtime_stop_id.toString().replace(/'/g, "''");
    const escapedStaticId = match.static_stop_id.toString().replace(/'/g, "''");
    sqlInserts.push(`('${escapedRealtimeId}', '${escapedStaticId}')`);
  }

  if (sqlInserts.length > 0) {
    sqlContent += sqlInserts.join(',\n') + ';\n';
  } else {
    sqlContent += '--- No valid mapping records found\n';
  }

  fs.writeFileSync(OUTPUT_SQL_PATH, sqlContent, 'utf8');
  console.log("Pipeline processing completed successfully!");
}

// Start execution
runReconciliation().catch(console.error);
