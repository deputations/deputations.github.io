// AllDeputations India Map — Sample fixture data
// Labels any output as sample data; never connected to real vacancies.
//
// Counts: distinct vacancy LISTINGS (not posts). A multi-post ad = 1 listing.
// Multi-state listings may count in each relevant state but once nationally.
// Nationwide and unknown-location records appear in separate buckets only.

// ===== PROVIDER BOUNDARY =====
// Everything below is mock. The adapter boundary (to be built later) lives
// in js/map-provider.js and accepts the same shape from enriched vacancy records.

export const SCENARIO = "populated"; // flip to "empty" for all-zero testing

export const EXCHANGES = [
  { id: "all",       label: "All Job Exchange",         icon: "briefcase",  available: true  },
  { id: "govt",      label: "Government Job Discovery",  icon: "building-2", available: true  },
  { id: "private",   label: "Private Job Exchange",      icon: "building",   available: true  },
  { id: "internship",label: "Internship Exchange",       icon: "graduation",  available: true  },
  { id: "manpower",  label: "Manpower Exchange",        icon: "users",      available: true  },
  { id: "campus",    label: "Campus Recruitment",       icon: "landmark",   available: false },
  { id: "entrance",  label: "Entrance Exam",            icon: "book-open",  available: false }
];

// Functional categories used in the Pune results view
export const FUNCTIONS = [
  "Show all functional jobs",
  "Executive & Leadership",
  "Information Technology (IT)",
  "Marketing & Communications",
  "Operations & Supply Chain",
  "Sales & Business Development"
];

// Filter options
export const FILTERS = {
  qualification: ["Any", "10th Pass", "12th Pass", "Graduate", "Post Graduate", "Doctorate"],
  experience:   ["Any", "0-1 years", "1-3 years", "3-5 years", "5-10 years", "10+ years"],
  jobType:      ["Any", "Full-time", "Part-time", "Contract", "Temporary"],
  jobTime:      ["Any", "Day Shift", "Night Shift", "Flexible"],
  jobShift:     ["Any", "On-site", "Remote", "Hybrid"]
};

// Helper: stable listing ID
let _id = 1;
const nextId = () => `LIST-${String(_id++).padStart(3,'0')}`;

export const POPULATED_LISTINGS = [
  // --- Maharashtra (6) ---
  { id: nextId(), title: "Section Officer – Pune Division", state: "MH", district: "Pune", city: "Pune",
    category: "govt", function: "Executive & Leadership", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "3-5 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-10-15", active: true },
  { id: nextId(), title: "Assistant Director – Mumbai", state: "MH", district: "Mumbai City", city: "Mumbai",
    category: "govt", function: "Executive & Leadership", qualification: "Post Graduate", qualificationGroup: "Post Graduate (General)", experience: "5-10 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-11-01", active: true },
  { id: nextId(), title: "Software Engineer – Nagpur IT Cell", state: "MH", district: "Nagpur", city: "Nagpur",
    category: "private", function: "Information Technology (IT)", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "1-3 years",
    jobType: "Full-time", jobTime: "Flexible", jobShift: "Remote",
    posts: 1, closingDate: "2026-09-30", active: true },
  { id: nextId(), title: "Marketing Manager – Thane", state: "MH", district: "Thane", city: "Thane",
    category: "private", function: "Marketing & Communications", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "3-5 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "Hybrid",
    posts: 2, closingDate: "2026-10-20", active: true },
  { id: nextId(), title: "Supply Chain Analyst – Pune", state: "MH", district: "Pune", city: "Pune",
    category: "private", function: "Operations & Supply Chain", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "1-3 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-11-15", active: true },
  { id: nextId(), title: "Sales Executive – Mumbai", state: "MH", district: "Mumbai Suburban", city: "Mumbai",
    category: "private", function: "Sales & Business Development", qualification: "12th Pass", qualificationGroup: "12th Pass", experience: "0-1 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-10-05", active: true },

  // --- Delhi (2) ---
  { id: nextId(), title: "Deputation Officer – Central Secretariat", state: "DL", district: "New Delhi", city: "New Delhi",
    category: "govt", function: "Executive & Leadership", qualification: "Post Graduate", qualificationGroup: "Post Graduate (General)", experience: "5-10 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-11-20", active: true },
  { id: nextId(), title: "Data Analyst – Delhi Govt", state: "DL", district: "New Delhi", city: "New Delhi",
    category: "govt", function: "Information Technology (IT)", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "1-3 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-10-10", active: true },

  // --- Karnataka (1) ---
  { id: nextId(), title: "Product Manager – Bengaluru", state: "KA", district: "Bengaluru Urban", city: "Bengaluru",
    category: "private", function: "Executive & Leadership", qualification: "Post Graduate", qualificationGroup: "Post Graduate (General)", experience: "5-10 years",
    jobType: "Full-time", jobTime: "Flexible", jobShift: "Hybrid",
    posts: 1, closingDate: "2026-11-30", active: true },

  // --- Tamil Nadu (1) ---
  { id: nextId(), title: "Intern – Chennai Development", state: "TN", district: "Chennai", city: "Chennai",
    category: "internship", function: "Operations & Supply Chain", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "0-1 years",
    jobType: "Part-time", jobTime: "Flexible", jobShift: "Remote",
    posts: 1, closingDate: "2026-09-25", active: true },

  // --- Uttar Pradesh (1) ---
  { id: nextId(), title: "Block Development Officer – Lucknow", state: "UP", district: "Lucknow", city: "Lucknow",
    category: "govt", function: "Executive & Leadership", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "3-5 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-10-25", active: true },

  // --- West Bengal (1) ---
  { id: nextId(), title: "Content Writer – Kolkata", state: "WB", district: "Kolkata", city: "Kolkata",
    category: "private", function: "Marketing & Communications", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "0-1 years",
    jobType: "Full-time", jobTime: "Flexible", jobShift: "Remote",
    posts: 1, closingDate: "2026-10-08", active: true },

  // --- Gujarat (1) ---
  { id: nextId(), title: "Industrial Engineer – Ahmedabad", state: "GJ", district: "Ahmedabad", city: "Ahmedabad",
    category: "private", function: "Operations & Supply Chain", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "3-5 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-11-10", active: true },

  // --- Rajasthan (1) ---
  { id: nextId(), title: "Tourism Officer – Jaipur", state: "RJ", district: "Jaipur", city: "Jaipur",
    category: "govt", function: "Marketing & Communications", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "1-3 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-10-18", active: true },

  // --- Telangana (1) ---
  { id: nextId(), title: "DevOps Engineer – Hyderabad", state: "TS", district: "Hyderabad", city: "Hyderabad",
    category: "private", function: "Information Technology (IT)", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "3-5 years",
    jobType: "Full-time", jobTime: "Flexible", jobShift: "Remote",
    posts: 1, closingDate: "2026-11-05", active: true },

  // --- Kerala (1) ---
  { id: nextId(), title: "Marine Biologist – Kochi", state: "KL", district: "Ernakulam", city: "Kochi",
    category: "govt", function: "Operations & Supply Chain", qualification: "Post Graduate", qualificationGroup: "Post Graduate (General)", experience: "5-10 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-11-22", active: true },

  // --- Assam (1) ---
  { id: nextId(), title: "Tea Board Officer – Guwahati", state: "AS", district: "Kamrup", city: "Guwahati",
    category: "govt", function: "Executive & Leadership", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "3-5 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-10-28", active: true }
];

// Edge-case fixtures for completeness testing

// Multi-state listing: appears in two states but counts once nationally
export const MULTI_STATE_LISTINGS = [
  { id: nextId(), title: "Cross-State Coordinator – MH & GJ", state: "MH,GJ", district: "Pune", city: "Pune",
    category: "govt", function: "Executive & Leadership", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "3-5 years",
    jobType: "Full-time", jobTime: "Day Shift", jobShift: "On-site",
    posts: 1, closingDate: "2026-12-01", active: true }
];

// Nationwide listing: state="All India"
export const NATIONWIDE_LISTINGS = [
  { id: nextId(), title: "National Program Director", state: "All India", district: null, city: "Remote",
    category: "govt", function: "Executive & Leadership", qualification: "Post Graduate", qualificationGroup: "Post Graduate (General)", experience: "10+ years",
    jobType: "Full-time", jobTime: "Flexible", jobShift: "Remote",
    posts: 1, closingDate: "2026-12-31", active: true }
];

// Unknown state listing: no state
export const UNKNOWN_LISTINGS = [
  { id: nextId(), title: "Remote Consultant – Location TBD", state: null, district: null, city: "Remote",
    category: "private", function: "Operations & Supply Chain", qualification: "Graduate", qualificationGroup: "Graduate (General)", experience: "1-3 years",
    jobType: "Part-time", jobTime: "Flexible", jobShift: "Remote",
    posts: 1, closingDate: "2026-11-30", active: true }
];

// Zero-result state for testing
export const ZERO_STATE = "MZ";
