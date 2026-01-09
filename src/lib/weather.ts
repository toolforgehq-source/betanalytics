/**
 * Weather Integration for Outdoor Sports
 * 
 * Fetches weather data from OpenWeatherMap API for outdoor sports venues.
 * Weather is critical for betting analysis on:
 * - NFL (wind affects passing, rain affects ball handling)
 * - MLB (wind affects home runs, temperature affects ball flight)
 * - MLS/Soccer (rain affects ball control, wind affects long passes)
 * - Golf (wind is crucial for shot selection)
 * - NASCAR/F1 (rain changes tire strategy completely)
 */

const OPENWEATHER_API_BASE = 'https://api.openweathermap.org/data/2.5/weather'

// NFL Stadium coordinates (for outdoor stadiums)
const NFL_STADIUMS: Record<string, { lat: number; lon: number; name: string; indoor: boolean }> = {
  // Outdoor stadiums
  'Buffalo Bills': { lat: 42.7738, lon: -78.7870, name: 'Highmark Stadium', indoor: false },
  'Miami Dolphins': { lat: 25.9580, lon: -80.2389, name: 'Hard Rock Stadium', indoor: false },
  'New England Patriots': { lat: 42.0909, lon: -71.2643, name: 'Gillette Stadium', indoor: false },
  'New York Jets': { lat: 40.8135, lon: -74.0745, name: 'MetLife Stadium', indoor: false },
  'New York Giants': { lat: 40.8135, lon: -74.0745, name: 'MetLife Stadium', indoor: false },
  'Baltimore Ravens': { lat: 39.2780, lon: -76.6227, name: 'M&T Bank Stadium', indoor: false },
  'Cincinnati Bengals': { lat: 39.0955, lon: -84.5161, name: 'Paycor Stadium', indoor: false },
  'Cleveland Browns': { lat: 41.5061, lon: -81.6995, name: 'Cleveland Browns Stadium', indoor: false },
  'Pittsburgh Steelers': { lat: 40.4468, lon: -80.0158, name: 'Acrisure Stadium', indoor: false },
  'Tennessee Titans': { lat: 36.1665, lon: -86.7713, name: 'Nissan Stadium', indoor: false },
  'Jacksonville Jaguars': { lat: 30.3239, lon: -81.6373, name: 'TIAA Bank Field', indoor: false },
  'Denver Broncos': { lat: 39.7439, lon: -105.0201, name: 'Empower Field', indoor: false },
  'Kansas City Chiefs': { lat: 39.0489, lon: -94.4839, name: 'Arrowhead Stadium', indoor: false },
  'Las Vegas Raiders': { lat: 36.0909, lon: -115.1833, name: 'Allegiant Stadium', indoor: true },
  'Los Angeles Chargers': { lat: 33.9535, lon: -118.3392, name: 'SoFi Stadium', indoor: true },
  'Los Angeles Rams': { lat: 33.9535, lon: -118.3392, name: 'SoFi Stadium', indoor: true },
  'Chicago Bears': { lat: 41.8623, lon: -87.6167, name: 'Soldier Field', indoor: false },
  'Detroit Lions': { lat: 42.3400, lon: -83.0456, name: 'Ford Field', indoor: true },
  'Green Bay Packers': { lat: 44.5013, lon: -88.0622, name: 'Lambeau Field', indoor: false },
  'Minnesota Vikings': { lat: 44.9736, lon: -93.2575, name: 'U.S. Bank Stadium', indoor: true },
  'Carolina Panthers': { lat: 35.2258, lon: -80.8528, name: 'Bank of America Stadium', indoor: false },
  'New Orleans Saints': { lat: 29.9511, lon: -90.0812, name: 'Caesars Superdome', indoor: true },
  'Tampa Bay Buccaneers': { lat: 27.9759, lon: -82.5033, name: 'Raymond James Stadium', indoor: false },
  'Atlanta Falcons': { lat: 33.7554, lon: -84.4010, name: 'Mercedes-Benz Stadium', indoor: true },
  'Arizona Cardinals': { lat: 33.5276, lon: -112.2626, name: 'State Farm Stadium', indoor: true },
  'San Francisco 49ers': { lat: 37.4033, lon: -121.9694, name: "Levi's Stadium", indoor: false },
  'Seattle Seahawks': { lat: 47.5952, lon: -122.3316, name: 'Lumen Field', indoor: false },
  'Philadelphia Eagles': { lat: 39.9008, lon: -75.1675, name: 'Lincoln Financial Field', indoor: false },
  'Dallas Cowboys': { lat: 32.7473, lon: -97.0945, name: 'AT&T Stadium', indoor: true },
  'Washington Commanders': { lat: 38.9076, lon: -76.8645, name: 'FedExField', indoor: false },
  'Houston Texans': { lat: 29.6847, lon: -95.4107, name: 'NRG Stadium', indoor: true },
  'Indianapolis Colts': { lat: 39.7601, lon: -86.1639, name: 'Lucas Oil Stadium', indoor: true },
}

// MLB Stadium coordinates (all outdoor except a few with retractable roofs)
const MLB_STADIUMS: Record<string, { lat: number; lon: number; name: string; indoor: boolean }> = {
  'New York Yankees': { lat: 40.8296, lon: -73.9262, name: 'Yankee Stadium', indoor: false },
  'New York Mets': { lat: 40.7571, lon: -73.8458, name: 'Citi Field', indoor: false },
  'Boston Red Sox': { lat: 42.3467, lon: -71.0972, name: 'Fenway Park', indoor: false },
  'Los Angeles Dodgers': { lat: 34.0739, lon: -118.2400, name: 'Dodger Stadium', indoor: false },
  'Chicago Cubs': { lat: 41.9484, lon: -87.6553, name: 'Wrigley Field', indoor: false },
  'Chicago White Sox': { lat: 41.8299, lon: -87.6338, name: 'Guaranteed Rate Field', indoor: false },
  'San Francisco Giants': { lat: 37.7786, lon: -122.3893, name: 'Oracle Park', indoor: false },
  'Houston Astros': { lat: 29.7573, lon: -95.3555, name: 'Minute Maid Park', indoor: true },
  'Texas Rangers': { lat: 32.7512, lon: -97.0832, name: 'Globe Life Field', indoor: true },
  'Arizona Diamondbacks': { lat: 33.4455, lon: -112.0667, name: 'Chase Field', indoor: true },
  'Seattle Mariners': { lat: 47.5914, lon: -122.3325, name: 'T-Mobile Park', indoor: true },
  'Toronto Blue Jays': { lat: 43.6414, lon: -79.3894, name: 'Rogers Centre', indoor: true },
  'Miami Marlins': { lat: 25.7781, lon: -80.2196, name: 'loanDepot park', indoor: true },
  'Milwaukee Brewers': { lat: 43.0280, lon: -87.9712, name: 'American Family Field', indoor: true },
  'Tampa Bay Rays': { lat: 27.7682, lon: -82.6534, name: 'Tropicana Field', indoor: true },
  'Atlanta Braves': { lat: 33.8907, lon: -84.4677, name: 'Truist Park', indoor: false },
  'Philadelphia Phillies': { lat: 39.9061, lon: -75.1665, name: 'Citizens Bank Park', indoor: false },
  'Washington Nationals': { lat: 38.8730, lon: -77.0074, name: 'Nationals Park', indoor: false },
  'Baltimore Orioles': { lat: 39.2838, lon: -76.6218, name: 'Camden Yards', indoor: false },
  'Cleveland Guardians': { lat: 41.4962, lon: -81.6852, name: 'Progressive Field', indoor: false },
  'Detroit Tigers': { lat: 42.3390, lon: -83.0485, name: 'Comerica Park', indoor: false },
  'Minnesota Twins': { lat: 44.9817, lon: -93.2776, name: 'Target Field', indoor: false },
  'Kansas City Royals': { lat: 39.0517, lon: -94.4803, name: 'Kauffman Stadium', indoor: false },
  'Los Angeles Angels': { lat: 33.8003, lon: -117.8827, name: 'Angel Stadium', indoor: false },
  'Oakland Athletics': { lat: 37.7516, lon: -122.2005, name: 'Oakland Coliseum', indoor: false },
  'San Diego Padres': { lat: 32.7076, lon: -117.1570, name: 'Petco Park', indoor: false },
  'Colorado Rockies': { lat: 39.7559, lon: -104.9942, name: 'Coors Field', indoor: false },
  'Pittsburgh Pirates': { lat: 40.4469, lon: -80.0057, name: 'PNC Park', indoor: false },
  'Cincinnati Reds': { lat: 39.0979, lon: -84.5082, name: 'Great American Ball Park', indoor: false },
  'St. Louis Cardinals': { lat: 38.6226, lon: -90.1928, name: 'Busch Stadium', indoor: false },
}

export interface WeatherData {
  location: string
  temperature: number // Fahrenheit
  feelsLike: number
  humidity: number
  windSpeed: number // mph
  windDirection: string
  conditions: string
  precipitation: number // probability 0-100
  visibility: number // miles
  isIndoor: boolean
  impact: WeatherImpact
}

export interface WeatherImpact {
  level: 'none' | 'low' | 'moderate' | 'high' | 'severe'
  factors: string[]
  recommendation: string
}

/**
 * Convert wind degrees to cardinal direction
 */
function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(degrees / 22.5) % 16
  return directions[index]
}

/**
 * Analyze weather impact on the game
 */
function analyzeWeatherImpact(weather: Omit<WeatherData, 'impact'>, sport: string): WeatherImpact {
  const factors: string[] = []
  let level: WeatherImpact['level'] = 'none'
  
  if (weather.isIndoor) {
    return {
      level: 'none',
      factors: ['Indoor stadium - weather not a factor'],
      recommendation: 'Weather does not affect this game.'
    }
  }
  
  // Wind analysis
  if (weather.windSpeed >= 20) {
    factors.push(`High wind (${weather.windSpeed} mph) - significant impact on passing/kicking`)
    level = 'high'
  } else if (weather.windSpeed >= 15) {
    factors.push(`Moderate wind (${weather.windSpeed} mph) - may affect long passes/kicks`)
    level = level === 'none' ? 'moderate' : level
  } else if (weather.windSpeed >= 10) {
    factors.push(`Light wind (${weather.windSpeed} mph) - minimal impact`)
    level = level === 'none' ? 'low' : level
  }
  
  // Temperature analysis
  if (weather.temperature <= 32) {
    factors.push(`Freezing conditions (${weather.temperature}°F) - affects ball handling, player mobility`)
    level = 'high'
  } else if (weather.temperature <= 40) {
    factors.push(`Cold conditions (${weather.temperature}°F) - may affect grip and stamina`)
    level = level === 'none' ? 'moderate' : level
  } else if (weather.temperature >= 90) {
    factors.push(`Hot conditions (${weather.temperature}°F) - fatigue factor, especially late in game`)
    level = level === 'none' ? 'moderate' : level
  }
  
  // Precipitation analysis
  if (weather.conditions.toLowerCase().includes('rain') || weather.conditions.toLowerCase().includes('snow')) {
    if (weather.conditions.toLowerCase().includes('heavy')) {
      factors.push(`Heavy precipitation - major impact on ball control and footing`)
      level = 'severe'
    } else {
      factors.push(`Precipitation expected - affects ball handling and field conditions`)
      level = level === 'none' || level === 'low' ? 'moderate' : level
    }
  }
  
  // Sport-specific recommendations
  let recommendation = ''
  if (sport === 'NFL' || sport === 'NCAAF') {
    if (level === 'high' || level === 'severe') {
      recommendation = 'Consider UNDER on totals, favor run-heavy teams, be cautious on passing props.'
    } else if (level === 'moderate') {
      recommendation = 'Weather may slightly favor running game. Monitor wind for field goal props.'
    } else {
      recommendation = 'Weather should not significantly impact betting strategy.'
    }
  } else if (sport === 'MLB') {
    if (weather.windSpeed >= 15) {
      recommendation = weather.windDirection.includes('N') 
        ? 'Wind blowing IN - favors pitchers, consider UNDER on runs.'
        : 'Wind blowing OUT - favors hitters, consider OVER on runs and home run props.'
    } else {
      recommendation = 'Weather conditions are favorable for normal play.'
    }
  } else if (sport === 'MLS' || sport.includes('soccer')) {
    if (level === 'high' || level === 'severe') {
      recommendation = 'Wet/windy conditions favor defensive play. Consider UNDER on goals.'
    } else {
      recommendation = 'Weather should not significantly impact the match.'
    }
  }
  
  if (factors.length === 0) {
    factors.push('Good weather conditions')
    recommendation = 'Weather is not a significant factor for this game.'
  }
  
  return { level, factors, recommendation }
}

/**
 * Fetch weather for a specific location
 */
async function fetchWeatherForLocation(lat: number, lon: number, locationName: string, isIndoor: boolean, sport: string): Promise<WeatherData | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY
  
  if (!apiKey) {
    console.error('[fetchWeatherForLocation] OPENWEATHER_API_KEY not configured')
    return null
  }
  
  try {
    const url = `${OPENWEATHER_API_BASE}?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial`
    const response = await fetch(url, { cache: 'no-store' })
    
    if (!response.ok) {
      console.error(`[fetchWeatherForLocation] API error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    
    const weatherData: Omit<WeatherData, 'impact'> = {
      location: locationName,
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed),
      windDirection: getWindDirection(data.wind.deg || 0),
      conditions: data.weather[0]?.description || 'Unknown',
      precipitation: data.rain?.['1h'] ? 100 : (data.clouds?.all || 0) > 80 ? 50 : 0,
      visibility: Math.round((data.visibility || 10000) / 1609.34), // Convert meters to miles
      isIndoor,
    }
    
    return {
      ...weatherData,
      impact: analyzeWeatherImpact(weatherData, sport),
    }
  } catch (error) {
    console.error(`[fetchWeatherForLocation] Error:`, error)
    return null
  }
}

/**
 * Get weather for an NFL game based on home team
 */
export async function getWeatherForNFLGame(homeTeam: string): Promise<WeatherData | null> {
  const stadium = NFL_STADIUMS[homeTeam]
  if (!stadium) {
    console.log(`[getWeatherForNFLGame] No stadium data for: ${homeTeam}`)
    return null
  }
  
  return fetchWeatherForLocation(stadium.lat, stadium.lon, stadium.name, stadium.indoor, 'NFL')
}

/**
 * Get weather for an MLB game based on home team
 */
export async function getWeatherForMLBGame(homeTeam: string): Promise<WeatherData | null> {
  const stadium = MLB_STADIUMS[homeTeam]
  if (!stadium) {
    console.log(`[getWeatherForMLBGame] No stadium data for: ${homeTeam}`)
    return null
  }
  
  return fetchWeatherForLocation(stadium.lat, stadium.lon, stadium.name, stadium.indoor, 'MLB')
}

/**
 * Get weather for outdoor games from a list of games
 * Returns weather data keyed by game ID
 */
export async function getWeatherForGames(games: Array<{ id: string; homeTeam: string; sport: string }>): Promise<Map<string, WeatherData>> {
  const weatherMap = new Map<string, WeatherData>()
  
  const outdoorSports = ['NFL', 'NCAAF', 'MLB', 'MLS', 'English Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1']
  
  const outdoorGames = games.filter(g => outdoorSports.includes(g.sport))
  
  // Fetch weather for outdoor games in parallel (limit to 10 to avoid rate limits)
  const weatherPromises = outdoorGames.slice(0, 10).map(async (game) => {
    let weather: WeatherData | null = null
    
    if (game.sport === 'NFL' || game.sport === 'NCAAF') {
      weather = await getWeatherForNFLGame(game.homeTeam)
    } else if (game.sport === 'MLB') {
      weather = await getWeatherForMLBGame(game.homeTeam)
    }
    // For soccer, we'd need venue coordinates which we don't have yet
    
    if (weather) {
      weatherMap.set(game.id, weather)
    }
  })
  
  await Promise.allSettled(weatherPromises)
  
  return weatherMap
}

/**
 * Format weather data for Claude's context
 */
export function formatWeatherForContext(weatherMap: Map<string, WeatherData>, games: Array<{ id: string; homeTeam: string; awayTeam: string; sport: string }>): string {
  if (weatherMap.size === 0) {
    return ''
  }
  
  const lines: string[] = []
  lines.push(`\n=== WEATHER CONDITIONS FOR OUTDOOR GAMES ===`)
  lines.push(`Weather data from OpenWeatherMap. Critical for betting analysis on outdoor sports.`)
  lines.push(``)
  
  for (const game of games) {
    const weather = weatherMap.get(game.id)
    if (!weather) continue
    
    lines.push(`--- ${game.awayTeam} @ ${game.homeTeam} (${game.sport}) ---`)
    lines.push(`Location: ${weather.location}`)
    
    if (weather.isIndoor) {
      lines.push(`INDOOR STADIUM - Weather not a factor`)
    } else {
      lines.push(`Temperature: ${weather.temperature}°F (feels like ${weather.feelsLike}°F)`)
      lines.push(`Wind: ${weather.windSpeed} mph ${weather.windDirection}`)
      lines.push(`Conditions: ${weather.conditions}`)
      lines.push(`Humidity: ${weather.humidity}%`)
      lines.push(`Impact Level: ${weather.impact.level.toUpperCase()}`)
      
      if (weather.impact.factors.length > 0) {
        lines.push(`Factors: ${weather.impact.factors.join('; ')}`)
      }
      
      lines.push(`Recommendation: ${weather.impact.recommendation}`)
    }
    lines.push(``)
  }
  
  return lines.join('\n')
}
