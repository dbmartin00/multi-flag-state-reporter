const axios = require("axios");
const fs = require("fs");

// ----------------- CONFIG -----------------
const API_TOKEN = process.env.HARNESS_API_TOKEN; 
const PROJECT_ID = process.env.HARNESS_PROJECT_ID;
const ENVIRONMENT_ID = process.env.HARNESS_ENVIRONMENT_ID;

//-------------------------------------------

async function getFlags() {
  const baseUrl = `https://api.split.io/internal/api/v2/splits/ws/${PROJECT_ID}`;
  const limit = 50; // you can adjust this if needed
  let offset = 0;

  const allFlags = [];

  console.log('Fetching flags with pagination...');

  try {
    while (true) {
      const url = `${baseUrl}?offset=${offset}&limit=${limit}`;
      console.log(`GET ${url}`);

      const resp = await axios.get(url, {
        headers: { 'x-api-key': API_TOKEN }
      });

      const { objects, totalCount } = resp.data;

      console.log(`Fetched ${objects.length} flags (offset=${offset})`);

      // Map and store
      allFlags.push(
        ...objects.map(o => ({
          id: o.id,
          name: o.name,
          rolloutStatus: o.rolloutStatus?.name ?? "Unknown"
        }))
      );

      // If we've reached or exceeded total count, stop
      offset += limit;
      if (offset >= totalCount) {
        console.log(`Pagination complete. Total flags collected: ${allFlags.length}`);
        break;
      }
    }

    return allFlags;

  } catch (error) {
    console.error("Error fetching flags:", error);
    return [];
  }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch project (workspace) name by listing workspaces
async function getProjectName() {
  const BASE_URL = 'https://fme-prod.harness.io/internal/api/v2/workspaces';
  const limit = 100;
  let offset = 0;

  try {
    while (true) {
      const resp = await axios.get(BASE_URL, {
        params: { limit, offset },
        headers: { 'x-api-key': API_TOKEN }
      });

      const { objects = [], totalCount = 0 } = resp.data || {};

      // Find workspace matching PROJECT_ID
      const workspace = objects.find(ws => ws.id === PROJECT_ID);
      if (workspace) {
        return workspace.name;
      }

      // Continue pagination
      offset += objects.length;
      if (offset >= totalCount || objects.length === 0) {
        break;
      }
    }

    console.warn("Project not found in workspace list");
    return PROJECT_ID;
  } catch (error) {
    console.error("Error fetching project name:", error.message);
    return PROJECT_ID;
  }
}

// Fetch environment name by listing environments
async function getEnvironmentName() {
  const url = `https://api.split.io/internal/api/v2/environments/ws/${PROJECT_ID}`;
  try {
    const resp = await axios.get(url, {
      headers: { 'x-api-key': API_TOKEN }
    });
    const environment = resp.data.find(env => env.id === ENVIRONMENT_ID);
    return environment?.name || ENVIRONMENT_ID;
  } catch (error) {
    console.error("Error fetching environment name:", error.message);
    return ENVIRONMENT_ID;
  }
}

// Fetch definition for a specific flag
async function getFlagDefinition(name) {
  await sleep(500);
  const getUrl = `https://api.split.io/internal/api/v2/splits/ws/${PROJECT_ID}/${name}/environments/${ENVIRONMENT_ID}`;

  try {
    const resp = await axios.get(getUrl, {
      headers: { 'x-api-key': API_TOKEN }
    });
    return resp.data;
  } catch (error) {
    console.log('error.response.data.code', error.response.data.code);
    if(error.response.data.code === 404) {
      console.log(name + ' not defined in this environment');
    } else {
      console.log(error);
    }
  }
}

function rowColor(def) {
  const rule = def.defaultRule || [];

  // 100% ON or OFF
  if (rule.length === 1 && rule[0].size === 100) {
    const treatment = rule[0].treatment.toLowerCase();
    if (treatment === "on") return "style='background:#d0ffd0'";   // green
    if (treatment === "off") return "style='background:#ffd0d0'";  // red
  }

  // 50/50 ON/OFF → Blue
  if (rule.length === 2) {
    const t1 = rule[0].treatment.toLowerCase();
    const s1 = rule[0].size;
    const t2 = rule[1].treatment.toLowerCase();
    const s2 = rule[1].size;

    const is50on50off =
      ((t1 === "on" && s1 === 50) && (t2 === "off" && s2 === 50)) ||
      ((t1 === "off" && s1 === 50) && (t2 === "on" && s2 === 50));

    if (is50on50off) return "style='background:#d0e0ff'";  // blue
  }

  // default → light gray
  return "style='background:#f6f6f6'";
}


// Main execution
async function main() {
  console.log("Fetching project and environment names...");
  const projectName = await getProjectName();
  const environmentName = await getEnvironmentName();
  console.log(`Project: ${projectName}, Environment: ${environmentName}`);

  console.log("Fetching flags...");
  const flags = await getFlags();

  console.log("Fetching definitions...");
  const enriched = [];
  for (const f of flags) {
    const def = await getFlagDefinition(f.name);
    if(!def || !def.defaultRule) {
      console.log('skipping ' + f.name + ' with no definition');
      continue;
    }
    console.log('f', f);
    console.log('def.defaultRule', def.defaultRule);

    enriched.push({
      name: f.name,
      rolloutStatus: f.rolloutStatus,
      defaultRule: def.defaultRule
    });
  }

  console.log("Building HTML...");
  const rows = enriched.map(f => {
    const color = rowColor(f);
    return `
      <tr ${color}>
        <td>${f.name}</td>
        <td>${f.rolloutStatus}</td>
        <td><pre>${JSON.stringify(f.defaultRule, null, 2)}</pre></td>
      </tr>
    `;
  }).join("");


  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Feature Flag Report</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 40px;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 20px;
      color: #333;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 14px;
    }
    th {
      background: #333;
      color: white;
      padding: 10px;
    }
    td {
      padding: 8px;
      border: 1px solid #ccc;
      vertical-align: top;
    }
    pre {
      margin: 0;
      font-size: 12px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <h1>Feature Flag Report - ${projectName} project, ${environmentName} environment</h1>
  <table>
    <tr>
      <th>Name</th>
      <th>Rollout Status</th>
      <th>Default Rule</th>
      <th>Killed</th>
    </tr>
    ${rows}
  </table>
</body>
</html>
`;

  fs.writeFileSync("report.html", html);
  console.log("report.html generated.");
}

main().catch(err => console.error("Fatal error:", err));
