/**
 * Protect Elo training data from exhibition/all-star rosters that ESPN may
 * label as postseason or return alongside real league results.
 * This is a data-integrity filter, not a prediction adjustment.
 */
export function isCompetitiveEloMatch(league: string, home: string, away: string): boolean {
  const normalize = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const excluded: Record<string, string[]> = {
    MLB: ['nationalallstars', 'americanallstars', 'nationalleagueallstars', 'americanleagueallstars'],
    NFL: ['afc', 'nfc'],
    NBA: ['world', 'teamstars', 'teamstripes', 'teamshaq', 'teamchuck', 'teamkenny'],
    NHL: ['atlanticdivision', 'centraldivision', 'pacificdivision', 'metropolitandivision'],
  }
  const ignored = excluded[league] || []
  const a = normalize(home)
  const b = normalize(away)
  return !!a && !!b && a !== b && !ignored.includes(a) && !ignored.includes(b)
}
