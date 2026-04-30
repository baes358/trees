const ENDPOINT = "https://data.cityofnewyork.us/resource/uvpi-gqnh.json";

const FIELDS = [
  "tree_id",
  "spc_common",
  "spc_latin",
  "tree_dbh",
  "health",
  "status",
  "boroname",
  "address",
  "latitude",
  "longitude",
];

export async function fetchTrees({ limit = 1000, offset = 0, borough = "" } = {}) {
  const params = new URLSearchParams();
  params.set("$select", FIELDS.join(","));
  params.set("$limit", String(limit));
  params.set("$offset", String(offset));
  const where = ["spc_common IS NOT NULL"];
  if (borough) where.push(`boroname='${borough}'`);
  params.set("$where", where.join(" AND "));
  params.set("$order", "tree_id");

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
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  return {
    id: row.tree_id,
    species,
    latin: (row.spc_latin || "").trim(),
    dbh,
    health: (row.health || "").toLowerCase() || null,
    status: (row.status || "Alive"),
    borough: row.boroname || "",
    address: row.address || "",
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

export function randomOffset(maxOffset = 580000) {
  return Math.floor(Math.random() * maxOffset);
}
