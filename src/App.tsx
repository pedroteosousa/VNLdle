import { useState, useEffect, useRef } from 'react'
import './App.css'

interface Player {
  nickname: string
  name: string
  number: string
  team: string
  category: string
  position: string
  birth_date: string
  height: string
  picture: string | null
}

type Result = 'correct' | 'higher' | 'lower' | 'wrong'
type Mode = 'daily' | 'endless'

interface GuessField {
  value: string
  compactValue?: string
  result: Result
}

interface GuessResult {
  player: Player
  fields: {
    category: GuessField
    team: GuessField
    position: GuessField
    height: GuessField
    number: GuessField
    birth_date: GuessField
  }
}

const YEARS = ['2021', '2022', '2023', '2024', '2025', '2026'] as const
type Year = (typeof YEARS)[number]

const dataModules = import.meta.glob('../data/*.json')

async function loadPlayers(year: Year): Promise<Player[]> {
  const key = `../data/${year}.json`
  const loader = dataModules[key]
  if (!loader) throw new Error(`No data for ${year}`)
  const mod = (await loader()) as { default: Player[] }
  return mod.default
}

function hashInt(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
  return n ^ (n >>> 16)
}

function getDailyTarget(players: Player[], year: Year): Player {
  const dayIndex = Math.floor(Date.now() / 86_400_000)
  const index = Math.abs(hashInt(dayIndex + parseInt(year) * 10000)) % players.length
  return players[index]
}

function getRandomTarget(players: Player[]): Player {
  return players[Math.floor(Math.random() * players.length)]
}

function parseHeight(h: string): number {
  return parseInt(h.replace('cm', ''), 10)
}

function parseDate(d: string): number {
  const [day, month, year] = d.split('/').map(Number)
  return new Date(year, month - 1, day).getTime()
}

function compareExact(g: string, t: string): Result {
  return g === t ? 'correct' : 'wrong'
}

function compareNumeric(
  gVal: string,
  tVal: string,
  parse: (v: string) => number
): Result {
  const g = parse(gVal),
    t = parse(tVal)
  if (g === t) return 'correct'
  return g < t ? 'higher' : 'lower'
}

function formatCategory(cat: string): string {
  return cat === 'men' ? "Men's" : "Women's"
}

function formatDate(d: string): string {
  const [day, month, year] = d.split('/').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function evaluateGuess(guess: Player, target: Player): GuessResult {
  return {
    player: guess,
    fields: {
      category: {
        value: formatCategory(guess.category),
        result: compareExact(guess.category, target.category),
      },
      team: {
        value: guess.team,
        result: compareExact(guess.team, target.team),
      },
      position: {
        value: guess.position,
        result: compareExact(guess.position, target.position),
      },
      height: {
        value: guess.height,
        result: compareNumeric(guess.height, target.height, parseHeight),
      },
      number: {
        value: '#' + guess.number,
        result: compareNumeric(
          guess.number,
          target.number,
          n => parseInt(n, 10)
        ),
      },
      birth_date: {
        value: formatDate(guess.birth_date),
        result: compareNumeric(
          guess.birth_date,
          target.birth_date,
          parseDate
        ),
      },
    },
  }
}

const availableYears = new Set(
  Object.keys(dataModules).map(k => k.match(/(\d{4})\.json$/)?.[1]).filter(Boolean)
)

function getDailyStorageKey(year: Year): string {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `vnldle-daily-${year}-${date}`
}

function saveDailyGuesses(year: Year, guesses: GuessResult[]): void {
  localStorage.setItem(getDailyStorageKey(year), JSON.stringify(guesses.map(g => g.player.name)))
}

function loadDailyGuesses(year: Year, players: Player[], target: Player): GuessResult[] {
  try {
    const saved = localStorage.getItem(getDailyStorageKey(year))
    if (!saved) return []
    const names: string[] = JSON.parse(saved)
    const byName = Object.fromEntries(players.map(p => [p.name, p]))
    return names.map(name => byName[name]).filter(Boolean).map(p => evaluateGuess(p, target))
  } catch {
    return []
  }
}

function Cell({ field }: { field: GuessField }) {
  const { value, compactValue, result } = field
  const arrow = result === 'higher' ? ' ↑' : result === 'lower' ? ' ↓' : ''
  return (
    <div className={`cell cell--${result}`}>
      <span className="cell-full">{value}{arrow}</span>
      <span className="cell-compact">{compactValue ?? value}{arrow}</span>
    </div>
  )
}

export default function App() {
  const [year, setYear] = useState<Year>('2026')
  const [mode, setMode] = useState<Mode>('endless')
  const [players, setPlayers] = useState<Player[]>([])
  const [target, setTarget] = useState<Player | null>(null)
  const [guesses, setGuesses] = useState<GuessResult[]>([])
  const [query, setQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setQuery('')

    loadPlayers(year)
      .then(p => {
        if (cancelled) return
        const t = mode === 'daily' ? getDailyTarget(p, year) : getRandomTarget(p)
        setPlayers(p)
        setTarget(t)
        setGuesses(mode === 'daily' ? loadDailyGuesses(year, p, t) : [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(`No data for ${year}. Run the scraper first.`)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [year, mode])

  const won = target ? guesses.some(g => g.player.name === target.name) : false
  const guessedNames = new Set(guesses.map(g => g.player.name))

  const q = query.toLowerCase()
  const suggestions =
    query.length > 0
      ? players
          .filter(
            p =>
              !guessedNames.has(p.name) &&
              (p.name.toLowerCase().includes(q) || p.nickname.toLowerCase().includes(q))
          )
          .slice(0, 8)
      : []

  function submitGuess(player: Player) {
    if (!target || guessedNames.has(player.name) || won) return
    const newGuesses = [evaluateGuess(player, target), ...guesses]
    setGuesses(newGuesses)
    if (mode === 'daily') saveDailyGuesses(year, newGuesses)
    setQuery('')
    setShowSuggestions(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && suggestions.length > 0) submitGuess(suggestions[0])
  }

  function nextPlayer() {
    setGuesses([])
    setQuery('')
    setTarget(getRandomTarget(players))
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div className="game">
      <header className="game-header">
        <h1>VNLdle</h1>
        <p>Guess the Volleyball Nations League player</p>
      </header>

      <div className="controls">
        <div className="control-group">
          <span className="control-label">Year</span>
          <select
            className="year-select"
            value={year}
            onChange={e => setYear(e.target.value as Year)}
          >
            {YEARS.map(y => (
              <option key={y} value={y} disabled={!availableYears.has(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <span className="control-label">Mode</span>
          <div className="pill-group">
            <button
              className={`pill ${mode === 'daily' ? 'active' : ''}`}
              onClick={() => setMode('daily')}
            >
              Daily
            </button>
            <button
              className={`pill ${mode === 'endless' ? 'active' : ''}`}
              onClick={() => setMode('endless')}
            >
              Endless
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="status-msg">Loading players…</p>
      ) : error ? (
        <p className="status-msg error">{error}</p>
      ) : (
        <>
          {!won ? (
            <div className="search-wrapper">
              <div className="search-box">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Type a player name…"
                  value={query}
                  autoComplete="off"
                  onChange={e => {
                    setQuery(e.target.value)
                    setShowSuggestions(true)
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() =>
                    setTimeout(() => setShowSuggestions(false), 150)
                  }
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="suggestions">
                    {suggestions.map(p => (
                      <li key={p.name} onMouseDown={() => submitGuess(p)}>
                        {p.picture ? (
                          <img src={p.picture} alt="" />
                        ) : (
                          <div className="suggestion-avatar-placeholder" />
                        )}
                        <span className="suggestion-name">{p.nickname}</span>
                        <span className="suggestion-meta">
                          {p.name} · {p.team}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {guesses.length > 0 && (
                <p className="guess-count">
                  {guesses.length} guess{guesses.length !== 1 ? 'es' : ''}
                </p>
              )}
            </div>
          ) : (
            <div className="win-banner">
              {target?.picture && (
                <img src={target.picture} alt={target.name} className="win-photo" />
              )}
              <div className="win-info">
                <p className="win-label">
                  {mode === 'daily' ? "Today's player" : 'You got it!'}
                </p>
                <p className="win-name">{target?.name}</p>
                <p className="win-sub">
                  {guesses.length} guess{guesses.length !== 1 ? 'es' : ''}
                  {mode === 'daily' && ' · Come back tomorrow!'}
                </p>
              </div>
              {mode === 'endless' && (
                <button className="next-btn" onClick={nextPlayer}>
                  Next →
                </button>
              )}
            </div>
          )}

          {guesses.length > 0 && (
            <div className="guess-grid-wrapper">
              <div className="guess-grid">
                <div className="grid-row grid-header">
                  <span>Player</span>
                  <span>Category</span>
                  <span>Country</span>
                  <span>Position</span>
                  <span>Height</span>
                  <span>Number</span>
                  <span>Born</span>
                </div>
                {guesses.map((g, i) => (
                  <div key={i} className="grid-row">
                    <div className="player-cell">
                      {g.player.picture ? (
                        <img src={g.player.picture} alt="" />
                      ) : (
                        <div className="avatar-placeholder" />
                      )}
                      <span title={g.player.name}>{g.player.nickname}</span>
                    </div>
                    <Cell field={g.fields.category} />
                    <Cell field={g.fields.team} />
                    <Cell field={g.fields.position} />
                    <Cell field={g.fields.height} />
                    <Cell field={g.fields.number} />
                    <Cell field={g.fields.birth_date} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
