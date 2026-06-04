const ENDPOINT = "https://data.cityofnewyork.us/resource/uvpi-gqnh.json";

// Only the fields actually rendered or shown in the tooltip. Dropping
// address/latitude/longitude (unused) roughly halves the payload.
const FIELDS = [
  "tree_id",
  "spc_common",
  "spc_latin",
  "tree_dbh",
  "health",
  "status",
  "boroname",
];

// tree_id runs 1..~722694 over ~684k rows. Keep headroom above the random
// start so a `tree_id > startId` window still yields a full page of results.
const MAX_TREE_ID = 722694;

export async function fetchTrees({ limit = 1000, startId = 0, borough = "" } = {}) {
  const params = new URLSearchParams();
  params.set("$select", FIELDS.join(","));
  params.set("$limit", String(limit));
  // Keyset range filter instead of $offset: hits the tree_id index directly
  // rather than scanning + skipping hundreds of thousands of rows. No $order,
  // since the trees get scattered randomly onto the skeleton anyway. Together
  // this cuts the first-load fetch from ~6s to well under 1s.
  const where = ["spc_common IS NOT NULL"];
  if (startId > 0) where.push(`tree_id > ${startId}`);
  if (borough) where.push(`boroname='${borough}'`);
  params.set("$where", where.join(" AND "));

  const url = `${ENDPOINT}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tree api ${res.status}`);
  const rows = await res.json();
  return rows.map(normalize).filter(Boolean);
}

function normalize(row) {
  const species = (row.spc_common || "").trim().toLowerCase();
  if (!species) return null;
  const dbh = Number(row.tree_dbh) || 0;
  return {
    id: row.tree_id,
    species,
    latin: (row.spc_latin || "").trim(),
    dbh,
    health: (row.health || "").toLowerCase() || null,
    status: (row.status || "Alive"),
    borough: row.boroname || "",
  };
}

export function randomStartId(margin = 20000) {
  return Math.floor(Math.random() * (MAX_TREE_ID - margin));
}
