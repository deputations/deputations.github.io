// js/state-geo.js — State/UT name ↔ abbreviation mapping
// SarvaLinks-compatible abbreviations (36 entries)

export const STATE_ABBR = {
  "Andaman and Nicobar": "AN",
  "Andhra Pradesh": "AP",
  "Arunachal Pradesh": "AR",
  "Assam": "AS",
  "Bihar": "BR",
  "Chandigarh": "CH",
  "Chhattisgarh": "CG",
  "Dadra and Nagar Haveli and Daman and Diu": "DNH-&-DD",
  "Dadra and Nagar Haveli": "DNH-&-DD",
  "Daman and Diu": "DNH-&-DD",
  "Delhi": "DL",
  "Goa": "GA",
  "Gujarat": "GJ",
  "Haryana": "HR",
  "Himachal Pradesh": "HP",
  "Jammu and Kashmir": "JK",
  "Jharkhand": "JH",
  "Karnataka": "KA",
  "Kerala": "KL",
  "Lakshadweep": "LD",
  "Ladakh": "LA",
  "Madhya Pradesh": "MP",
  "Maharashtra": "MH",
  "Manipur": "MN",
  "Meghalaya": "ML",
  "Mizoram": "MZ",
  "Nagaland": "NL",
  "Odisha": "OD",
  "Orissa": "OD",
  "Puducherry": "PY",
  "Punjab": "PB",
  "Rajasthan": "RJ",
  "Sikkim": "SK",
  "Tamil Nadu": "TN",
  "Telangana": "TS",
  "Tripura": "TR",
  "Uttar Pradesh": "UP",
  "Uttarakhand": "UK",
  "Uttaranchal": "UK",
  "West Bengal": "WB"
};

export const ABBR_TO_NAME = {};
for (const [name, abbr] of Object.entries(STATE_ABBR)) {
  if (!ABBR_TO_NAME[abbr]) ABBR_TO_NAME[abbr] = name;
}

export const STATE_LIST = Object.keys(STATE_ABBR).sort();
