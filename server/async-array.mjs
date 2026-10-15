// Explicit asynchronous collection operations used by the PostgreSQL business layer.
export async function mapAsync(values, fn) {
  return Promise.all(values.map(fn));
}
export async function filterAsync(values, fn) {
  const keep = await Promise.all(values.map(fn));
  return values.filter((_, i) => keep[i]);
}
export async function findAsync(values, fn) {
  for (const value of values) if (await fn(value)) return value;
}
export async function someAsync(values, fn) {
  for (const value of values) if (await fn(value)) return true;
  return false;
}
export async function forEachAsync(values, fn) {
  for (const value of values) await fn(value);
}
