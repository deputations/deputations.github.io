// Generate expanded listing fixture data
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distData = JSON.parse(fs.readFileSync(path.join(__dirname, '../geo/india-districts-all.geojson'), 'utf8'));

const byState = {};
distData.features.forEach(f => {
  const st = f.properties.st_nm;
  if (!byState[st]) byState[st] = [];
  byState[st].push(f.properties.district);
});

const TARGET_STATES = [
  'Karnataka','Tamil Nadu','Uttar Pradesh','West Bengal','Gujarat',
  'Rajasthan','Telangana','Kerala','Assam','Madhya Pradesh',
  'Odisha','Punjab','Haryana','Jharkhand','Chhattisgarh',
  'Bihar','Jammu and Kashmir','Andhra Pradesh'
];

const stateToAbbr = {
  'Karnataka':'KA','Tamil Nadu':'TN','Uttar Pradesh':'UP','West Bengal':'WB',
  'Gujarat':'GJ','Rajasthan':'RJ','Telangana':'TS','Kerala':'KL','Assam':'AS',
  'Madhya Pradesh':'MP','Odisha':'OD','Punjab':'PB','Haryana':'HR',
  'Jharkhand':'JH','Chhattisgarh':'CG','Bihar':'BR','Jammu and Kashmir':'JK',
  'Andhra Pradesh':'AP','Maharashtra':'MH','Delhi':'DL'
};

const existingStates = ['MH','DL','KA','TN','UP','WB','GJ','RJ','TS','KL','AS'];

const categories = ['govt','private','internship'];
const functions = ['Executive & Leadership','Information Technology (IT)','Marketing & Communications','Operations & Supply Chain','Sales & Business Development'];
const quals = ['Graduate','Post Graduate','12th Pass','10th Pass'];
const qualGroups = ['Graduate (General)','Post Graduate (General)','12th Pass','10th Pass'];
const experiences = ['0-1 years','1-3 years','3-5 years','5-10 years'];
const jobTypes = ['Full-time','Part-time','Contract'];
const jobShifts = ['On-site','Remote','Hybrid'];

function addListing(abbr, district, city, id) {
  const cat = categories[id % categories.length];
  const fn = functions[id % functions.length];
  const qIdx = id % quals.length;
  const q = quals[qIdx];
  const qg = qualGroups[qIdx];
  const exp = experiences[id % experiences.length];
  const jt = jobTypes[id % jobTypes.length];
  const js = jobShifts[id % jobShifts.length];
  const posts = (id % 4 === 0) ? 2 : 1;
  const month = String((id % 12) + 1).padStart(2, '0');
  const day = String((id % 28) + 1).padStart(2, '0');
  return `  { id: nextId(), title: "${cat === 'govt' ? 'Officer' : cat === 'internship' ? 'Intern' : 'Specialist'} – ${city}", state: "${abbr}", district: "${district}", city: "${city}",
    category: "${cat}", function: "${fn}", qualification: "${q}", qualificationGroup: "${qg}", experience: "${exp}",
    jobType: "${jt}", jobTime: "Day Shift", jobShift: "${js}",
    posts: ${posts}, closingDate: "2026-${month}-${day}", active: true },`;
}

let id = 100;
let output = '\n  // === Expanded fixtures for 18 additional states ===\n';

TARGET_STATES.forEach(stateName => {
  const abbr = stateToAbbr[stateName];
  if (existingStates.includes(abbr)) return;
  const districts = byState[stateName] || [];
  const count = Math.min(6, districts.length);
  const step = Math.max(1, Math.floor(districts.length / count));
  const chosen = [];
  for (let i = 0; i < districts.length && chosen.length < count; i += step) {
    chosen.push(districts[i]);
  }
  output += `\n  // --- ${stateName} (${abbr}) — ${chosen.length} districts ---\n`;
  chosen.forEach(d => {
    output += addListing(abbr, d, d, id++) + '\n';
  });
});

// Also expand existing states with a few more districts
const extraDistricts = {
  'MH': ['Nashik', 'Aurangabad', 'Kolhapur', 'Solapur', 'Sangli', 'Ahmednagar'],
  'DL': ['Central Delhi', 'South East Delhi'],
  'KA': ['Mysuru', 'Mangaluru', 'Hubli', 'Belgaum'],
  'TN': ['Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem'],
  'UP': ['Varanasi', 'Kanpur', 'Agra', 'Prayagraj', 'Meerut', 'Ghaziabad'],
  'WB': ['Howrah', 'Darjeeling', 'Asansol', 'Siliguri'],
  'GJ': ['Surat', 'Vadodara', 'Rajkot', 'Gandhinagar'],
  'RJ': ['Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner'],
  'TS': ['Warangal', 'Karimnagar', 'Nizamabad'],
  'KL': ['Thiruvananthapuram', 'Kozhikode', 'Thrissur'],
  'AS': ['Dibrugarh', 'Silchar', 'Jorhat']
};

output += '\n  // === Extra districts for existing states ===\n';
Object.entries(extraDistricts).forEach(([abbr, districts]) => {
  const stateName = Object.keys(stateToAbbr).find(k => stateToAbbr[k] === abbr);
  output += `\n  // --- ${stateName} (${abbr}) — ${districts.length} extra districts ---\n`;
  districts.forEach(d => {
    output += addListing(abbr, d, d, id++) + '\n';
  });
});

console.log(output);
console.log('\n// Total new listings:', id - 100);
