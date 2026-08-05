/**
 * Atomic Lua scripts for lease-aware idempotency store.
 *
 * Returns tagged arrays: first element is the outcome tag (string).
 * ARGV always includes injectable `nowMs` (string epoch ms) — never rely solely on TIME.
 *
 * Hash fields: key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
 * lease_expires_ms, attempts, generation, created_at, updated_at, result_json
 */

/** KEYS[1]=record  ARGV: nowMs, nowIso, fingerprint, owner, leaseToken, leaseMs, leaseExpiresAt, leaseExpiresMs */
export const IDEMPOTENCY_RESERVE_LUA = `
local rec = KEYS[1]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local fingerprint = ARGV[3]
local owner = ARGV[4]
local leaseToken = ARGV[5]
local leaseMs = ARGV[6]
local leaseExpiresAt = ARGV[7]
local leaseExpiresMs = ARGV[8]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

local function pack(m)
  return {
    m['key'] or '',
    m['status'] or '',
    m['fingerprint'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['result_json'] or ''
  }
end

local exists = redis.call('EXISTS', rec)
if exists == 0 then
  redis.call('HSET', rec,
    'key', ARGV[9] or '',
    'status', 'reserved',
    'fingerprint', fingerprint,
    'lease_owner', owner,
    'lease_token', leaseToken,
    'lease_expires_at', leaseExpiresAt,
    'lease_expires_ms', leaseExpiresMs,
    'attempts', '1',
    'generation', '1',
    'created_at', nowIso,
    'updated_at', nowIso,
    'result_json', ''
  )
  local m = hgetall_map(rec)
  local p = pack(m)
  return {'acquired', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], leaseToken}
end

local m = hgetall_map(rec)
local status = m['status'] or ''
local fp = m['fingerprint'] or ''

if fp ~= fingerprint then
  local p = pack(m)
  return {'fingerprint_conflict', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]}
end

if status == 'completed' then
  local p = pack(m)
  return {'already_completed', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]}
end

if status == 'indeterminate' then
  local p = pack(m)
  return {'indeterminate', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]}
end

if status == 'reserved' then
  local exp = tonumber(m['lease_expires_ms'] or '0') or 0
  if exp > nowMs then
    local p = pack(m)
    return {'in_progress', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]}
  end
end

-- re-reserve after expiry or free status
local gen = (tonumber(m['generation'] or '0') or 0) + 1
local attempts = (tonumber(m['attempts'] or '0') or 0) + 1
local created = m['created_at'] or nowIso
redis.call('HSET', rec,
  'status', 'reserved',
  'fingerprint', fingerprint,
  'lease_owner', owner,
  'lease_token', leaseToken,
  'lease_expires_at', leaseExpiresAt,
  'lease_expires_ms', leaseExpiresMs,
  'attempts', tostring(attempts),
  'generation', tostring(gen),
  'created_at', created,
  'updated_at', nowIso,
  'result_json', ''
)
m = hgetall_map(rec)
local p = pack(m)
return {'acquired', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], leaseToken}
`.trim();

/** KEYS[1]=record  ARGV: nowMs, nowIso, leaseToken, newLeaseToken, leaseExpiresAt, leaseExpiresMs */
export const IDEMPOTENCY_RENEW_LUA = `
local rec = KEYS[1]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local newToken = ARGV[4]
local leaseExpiresAt = ARGV[5]
local leaseExpiresMs = ARGV[6]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

local function pack(m)
  return {
    m['key'] or '',
    m['status'] or '',
    m['fingerprint'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['result_json'] or ''
  }
end

if redis.call('EXISTS', rec) == 0 then
  return {'not_found'}
end

local m = hgetall_map(rec)
if (m['status'] or '') ~= 'reserved' then
  local p = pack(m)
  return {'wrong_status', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]}
end

local exp = tonumber(m['lease_expires_ms'] or '0') or 0
if (m['lease_token'] or '') ~= leaseToken or exp <= nowMs then
  local p = pack(m)
  return {'lease_lost', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]}
end

local gen = (tonumber(m['generation'] or '0') or 0) + 1
redis.call('HSET', rec,
  'lease_token', newToken,
  'lease_expires_at', leaseExpiresAt,
  'lease_expires_ms', leaseExpiresMs,
  'generation', tostring(gen),
  'updated_at', nowIso
)
m = hgetall_map(rec)
local p = pack(m)
return {'ok', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], newToken}
`.trim();

/** KEYS[1]=record  ARGV: nowMs, nowIso, leaseToken, resultJson, retentionTtlSec (0=none) */
export const IDEMPOTENCY_COMPLETE_LUA = `
local rec = KEYS[1]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local resultJson = ARGV[4]
local retentionTtlSec = tonumber(ARGV[5]) or 0

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

if redis.call('EXISTS', rec) == 0 then
  return {'lease_lost'}
end

local m = hgetall_map(rec)
if (m['status'] or '') ~= 'reserved' or (m['lease_token'] or '') ~= leaseToken then
  return {'lease_lost'}
end
local exp = tonumber(m['lease_expires_ms'] or '0') or 0
if exp <= nowMs then
  return {'lease_lost'}
end

redis.call('HSET', rec,
  'status', 'completed',
  'result_json', resultJson,
  'lease_owner', '',
  'lease_token', '',
  'lease_expires_at', '',
  'lease_expires_ms', '0',
  'updated_at', nowIso
)
if retentionTtlSec > 0 then
  redis.call('EXPIRE', rec, retentionTtlSec)
end
return {'ok'}
`.trim();

/** KEYS[1]=record  ARGV: nowMs, nowIso, leaseToken, resultJson (may be empty) */
export const IDEMPOTENCY_MARK_INDETERMINATE_LUA = `
local rec = KEYS[1]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local resultJson = ARGV[4]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

if redis.call('EXISTS', rec) == 0 then
  return {'lease_lost'}
end

local m = hgetall_map(rec)
if (m['status'] or '') ~= 'reserved' or (m['lease_token'] or '') ~= leaseToken then
  return {'lease_lost'}
end

local rj = resultJson
if rj == '' then
  rj = m['result_json'] or ''
end

redis.call('HSET', rec,
  'status', 'indeterminate',
  'result_json', rj,
  'lease_owner', '',
  'lease_token', '',
  'lease_expires_at', '',
  'lease_expires_ms', '0',
  'updated_at', nowIso
)
return {'ok'}
`.trim();

/**
 * KEYS[1]=record — pure read path.
 * ARGV: nowMs, nowIso (kept for call-site parity; not used to mutate).
 *
 * A4 / REDIS-1: do NOT soft-expire or clear lease_token on get. Concurrent get
 * after lease wall-clock expiry must leave fencing tokens intact so the original
 * worker can still markIndeterminate / complete. Reclaim paths own transition
 * to expired + token wipe. Matches SQL get (SELECT only).
 */
export const IDEMPOTENCY_GET_LUA = `
local rec = KEYS[1]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

local function pack(m)
  return {
    m['key'] or '',
    m['status'] or '',
    m['fingerprint'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['result_json'] or ''
  }
end

if redis.call('EXISTS', rec) == 0 then
  return {'missing'}
end

local m = hgetall_map(rec)
local p = pack(m)
return {'ok', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]}
`.trim();

/**
 * KEYS[1]=scan cursor is not used; JS drives SCAN.
 * This script deletes a single terminal key when eligible.
 * KEYS[1]=record  ARGV: beforeMs (updated_at compared as ms stored? we store ISO — pass beforeIso and compare lexicographically for ISO)
 *
 * For safety we store updated_at as ISO-8601; lexicographic compare works for UTC ISO.
 * A4: never delete indeterminate.
 */
export const IDEMPOTENCY_DELETE_IF_EXPIRED_LUA = `
local rec = KEYS[1]
local beforeIso = ARGV[1]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

if redis.call('EXISTS', rec) == 0 then
  return {'skipped'}
end

local m = hgetall_map(rec)
local status = m['status'] or ''
if status == 'indeterminate' then
  return {'skipped'}
end

local updated = m['updated_at'] or ''
if updated > beforeIso then
  return {'skipped'}
end

if status == 'completed' or status == 'expired' then
  redis.call('DEL', rec)
  return {'deleted'}
end

return {'skipped'}
`.trim();
