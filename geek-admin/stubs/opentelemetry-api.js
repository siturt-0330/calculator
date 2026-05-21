// Stub for @opentelemetry/api — supabase-js dynamically imports this and
// catches failure, so we can safely return an empty module. This avoids
// pulling in the actual OTel runtime (~50KB) that we don't use.
module.exports = {};
