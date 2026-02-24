#!/usr/bin/env node
'use strict';

/**
 * redistribute-flights.js
 *
 * Redistributes flight dates from a 2023/2025/2028 concentration
 * into a 2025-2028 spread with ~10% YoY growth, keeping 2023 as-is.
 * Updates Flights, Bookings, Tickets, and Invoices CSVs consistently.
 */

const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────────
const DATA_DIR = path.resolve(__dirname, '..', 'db', 'data');
const FILES = {
  flights:  path.join(DATA_DIR, 'flights-Flights.csv'),
  bookings: path.join(DATA_DIR, 'flights-Bookings.csv'),
  tickets:  path.join(DATA_DIR, 'flights-Tickets.csv'),
  invoices: path.join(DATA_DIR, 'flights-Invoices.csv'),
};

// ── CSV helpers (no npm deps) ──────────────────────────────────────────────────
function readCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const lines = raw.split('\n');
  const header = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',');
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = vals[j] !== undefined ? vals[j] : '';
    }
    rows.push(row);
  }
  return { header, rows };
}

function writeCSV(filePath, header, rows) {
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map(h => row[h] !== undefined ? row[h] : '').join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// ── Date helpers ───────────────────────────────────────────────────────────────
function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
}

/** Change year in a YYYY-MM-DD date string; clamp Feb 29 → Feb 28 for non-leap */
function changeYear(dateStr, newYear) {
  const [, mm, dd] = dateStr.split('-');
  let day = parseInt(dd, 10);
  if (parseInt(mm, 10) === 2 && day === 29 && !isLeapYear(newYear)) {
    day = 28;
  }
  return `${newYear}-${mm}-${String(day).padStart(2, '0')}`;
}

/** Days between two YYYY-MM-DD strings (b - a) */
function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  return Math.round((db - da) / 86400000);
}

/** Shift a YYYY-MM-DD by N days */
function shiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ── Back up originals ──────────────────────────────────────────────────────────
console.log('=== Backing up CSVs ===');
for (const [name, fp] of Object.entries(FILES)) {
  const bak = fp + '.bak';
  fs.copyFileSync(fp, bak);
  console.log(`  ${name}: ${path.basename(fp)} -> ${path.basename(bak)}`);
}

// ── 1. Read Flights ────────────────────────────────────────────────────────────
const flights = readCSV(FILES.flights);

// Count by year BEFORE
const beforeCounts = {};
for (const row of flights.rows) {
  const yr = row.FLDATE.substring(0, 4);
  beforeCounts[yr] = (beforeCounts[yr] || 0) + 1;
}
console.log('\n=== BEFORE -- Flights per year ===');
for (const yr of Object.keys(beforeCounts).sort()) {
  console.log(`  ${yr}: ${beforeCounts[yr]}`);
}
console.log(`  TOTAL: ${flights.rows.length}`);

// ── 2. Separate 2023 vs rest ───────────────────────────────────────────────────
const keep2023 = [];
const toRedistribute = [];
for (const row of flights.rows) {
  if (row.FLDATE.startsWith('2023')) {
    keep2023.push(row);
  } else {
    toRedistribute.push(row);
  }
}
console.log(`\n  Keeping 2023 flights: ${keep2023.length}`);
console.log(`  Flights to redistribute: ${toRedistribute.length}`);

// ── 3. Sort by FLDATE (chronological) ─────────────────────────────────────────
toRedistribute.sort((a, b) => a.FLDATE.localeCompare(b.FLDATE));

// ── 4. Compute year buckets with ~10% YoY growth ──────────────────────────────
const N = toRedistribute.length;
const multipliers = [1, 1.1, 1.21, 1.331];
const sumMult = multipliers.reduce((s, m) => s + m, 0);
const base = N / sumMult;

const rawCounts = multipliers.map(m => Math.round(base * m));
// Adjust rounding so total matches exactly
let diff = N - rawCounts.reduce((s, c) => s + c, 0);
rawCounts[rawCounts.length - 1] += diff;

const yearBuckets = [
  { year: 2025, count: rawCounts[0] },
  { year: 2026, count: rawCounts[1] },
  { year: 2027, count: rawCounts[2] },
  { year: 2028, count: rawCounts[3] },
];

console.log('\n=== Target distribution ===');
let total = 0;
for (const b of yearBuckets) {
  console.log(`  ${b.year}: ${b.count}`);
  total += b.count;
}
console.log(`  TOTAL (non-2023): ${total}`);

// ── 5. Assign new year to each flight + build mapping ──────────────────────────
const flightMapping = new Map();  // "MANDT|CARRID|CONNID|oldFLDATE" -> newFLDATE

let cursor = 0;
let duplicateAdjustments = 0;
const usedKeys = new Set();

// Pre-populate usedKeys with 2023 flights
for (const row of keep2023) {
  const key = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${row.FLDATE}`;
  usedKeys.add(key);
}

for (const bucket of yearBuckets) {
  for (let i = 0; i < bucket.count; i++) {
    const row = toRedistribute[cursor];
    const oldDate = row.FLDATE;
    let newDate = changeYear(oldDate, bucket.year);

    // Check for duplicate composite key
    let candidateKey = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${newDate}`;
    let attempts = 0;
    while (usedKeys.has(candidateKey) && attempts < 30) {
      // Shift forward by 1 day to avoid collision
      newDate = shiftDate(newDate, 1);
      candidateKey = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${newDate}`;
      attempts++;
      duplicateAdjustments++;
    }
    if (usedKeys.has(candidateKey)) {
      // Try backward from the original candidate
      newDate = changeYear(oldDate, bucket.year);
      for (let back = 1; back <= 30; back++) {
        newDate = shiftDate(newDate, -1);
        candidateKey = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${newDate}`;
        if (!usedKeys.has(candidateKey)) break;
        duplicateAdjustments++;
      }
    }

    usedKeys.add(candidateKey);

    // Build the mapping key using the ORIGINAL (old) values
    const mapKey = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${oldDate}`;
    flightMapping.set(mapKey, newDate);

    // Update the flight row
    row.FLDATE = newDate;
    cursor++;
  }
}

console.log(`\n  Duplicate-avoidance date adjustments: ${duplicateAdjustments}`);

// Count by year AFTER
const afterCounts = {};
for (const row of [...keep2023, ...toRedistribute]) {
  const yr = row.FLDATE.substring(0, 4);
  afterCounts[yr] = (afterCounts[yr] || 0) + 1;
}
console.log('\n=== AFTER -- Flights per year ===');
for (const yr of Object.keys(afterCounts).sort()) {
  console.log(`  ${yr}: ${afterCounts[yr]}`);
}
console.log(`  TOTAL: ${keep2023.length + toRedistribute.length}`);

// Write Flights
const allFlights = [...keep2023, ...toRedistribute];
writeCSV(FILES.flights, flights.header, allFlights);
console.log(`\n  Wrote ${allFlights.length} flights to ${path.basename(FILES.flights)}`);

// ── 6. Update Bookings ────────────────────────────────────────────────────────
console.log('\n=== Updating Bookings ===');
const bookings = readCSV(FILES.bookings);
let bookingsUpdated = 0;
let bookingsSkipped = 0;
let orderDateIssues = 0;

for (const row of bookings.rows) {
  const mapKey = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${row.FLDATE}`;
  const newDate = flightMapping.get(mapKey);
  if (newDate) {
    const oldDate = row.FLDATE;
    const delta = daysBetween(oldDate, newDate);

    // Shift ORDER_DATE by same delta
    if (row.ORDER_DATE && row.ORDER_DATE !== '00000000' && row.ORDER_DATE.includes('-')) {
      const newOrderDate = shiftDate(row.ORDER_DATE, delta);
      // Validate ORDER_DATE < new FLDATE
      if (newOrderDate >= newDate) {
        // Force ORDER_DATE to be 1 day before FLDATE
        row.ORDER_DATE = shiftDate(newDate, -1);
        orderDateIssues++;
      } else {
        row.ORDER_DATE = newOrderDate;
      }
    }

    row.FLDATE = newDate;
    bookingsUpdated++;
  } else {
    bookingsSkipped++;
  }
}

writeCSV(FILES.bookings, bookings.header, bookings.rows);
console.log(`  Updated: ${bookingsUpdated}, Unchanged: ${bookingsSkipped}, ORDER_DATE clamped: ${orderDateIssues}`);

// ── 7. Update Tickets ──────────────────────────────────────────────────────────
// NOTE: Tickets CONNID may lack leading zeros (e.g. "402" vs "0402")
// We try both the raw CONNID and a zero-padded version for matching
console.log('\n=== Updating Tickets ===');
const tickets = readCSV(FILES.tickets);
let ticketsUpdated = 0;
let ticketsSkipped = 0;

for (const row of tickets.rows) {
  // Try direct match first
  let mapKey = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${row.FLDATE}`;
  let newDate = flightMapping.get(mapKey);

  if (!newDate) {
    // Try zero-padded CONNID (pad to 4 digits like Flights CSV)
    const paddedCONNID = row.CONNID.padStart(4, '0');
    mapKey = `${row.MANDT}|${row.CARRID}|${paddedCONNID}|${row.FLDATE}`;
    newDate = flightMapping.get(mapKey);
  }

  if (newDate) {
    row.FLDATE = newDate;
    ticketsUpdated++;
  } else {
    ticketsSkipped++;
  }
}

writeCSV(FILES.tickets, tickets.header, tickets.rows);
console.log(`  Updated: ${ticketsUpdated}, Unchanged: ${ticketsSkipped}`);

// ── 8. Update Invoices ─────────────────────────────────────────────────────────
console.log('\n=== Updating Invoices ===');
const invoices = readCSV(FILES.invoices);
let invoicesUpdated = 0;
let invoicesSkipped = 0;

for (const row of invoices.rows) {
  const mapKey = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${row.FLDATE}`;
  const newDate = flightMapping.get(mapKey);
  if (newDate) {
    row.FLDATE = newDate;
    invoicesUpdated++;
  } else {
    invoicesSkipped++;
  }
}

writeCSV(FILES.invoices, invoices.header, invoices.rows);
console.log(`  Updated: ${invoicesUpdated}, Unchanged: ${invoicesSkipped}`);

// ── 9. Final validation summary ────────────────────────────────────────────────
console.log('\n=== Validation ===');

// Check for duplicate composite keys in Flights
const flightKeys = new Set();
let flightDups = 0;
for (const row of allFlights) {
  const key = `${row.MANDT}|${row.CARRID}|${row.CONNID}|${row.FLDATE}`;
  if (flightKeys.has(key)) {
    flightDups++;
  }
  flightKeys.add(key);
}
console.log(`  Duplicate flight keys: ${flightDups}`);

// Spot-check ORDER_DATE < FLDATE in Bookings
let orderAfterFlight = 0;
for (const row of bookings.rows) {
  if (row.ORDER_DATE && row.ORDER_DATE.includes('-') && row.ORDER_DATE >= row.FLDATE) {
    orderAfterFlight++;
  }
}
console.log(`  Bookings with ORDER_DATE >= FLDATE: ${orderAfterFlight}`);

// Row counts
console.log('\n=== Final row counts ===');
console.log(`  Flights:  ${allFlights.length}`);
console.log(`  Bookings: ${bookings.rows.length}`);
console.log(`  Tickets:  ${tickets.rows.length}`);
console.log(`  Invoices: ${invoices.rows.length}`);

console.log('\nDone. Backups saved as .bak files in the data directory.');
