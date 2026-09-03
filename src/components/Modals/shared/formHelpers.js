export function dateError(start, end) {
  if (start && end && new Date(end) < new Date(start)) return 'A data de término não pode ser anterior à de início.'
  return null
}
