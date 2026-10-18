// Adaptador ESPN -> formato NBA liveData (el que ya lee index.html).
// NBA.com bloquea con Akamai, ESPN es público y gratis.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const TRI = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };
const tri = (a) => TRI[a] || a;

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!r.ok) throw new Error('ESPN HTTP ' + r.status);
  return r.json();
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

function isPor(ev) {
  const comp = (ev.competitions || [])[0];
  return comp && (comp.competitors || []).some((c) => c.team && c.team.abbreviation === 'POR');
}

function pick(events) {
  const por = events.filter(isPor);
  if (!por.length) return null;
  const live = por.find((e) => e.status && e.status.type && e.status.type.state === 'in');
  if (live) return live;
  const done = por.filter((e) => e.status && e.status.type && e.status.type.state === 'post');
  done.sort((a, b) => new Date(b.date) - new Date(a.date));
  return done[0] || por[0];
}

async function findEventId() {
  const now = Date.now();
  const from = ymd(new Date(now - 10 * 864e5));
  const to = ymd(new Date(now + 864e5));
  try {
    const sb = await getJson(`${BASE}/scoreboard?dates=${from}-${to}&limit=300`);
    const ev = pick(sb.events || []);
    if (ev) return ev.id;
  } catch (e) { /* sigue al schedule */ }
  // calendario del equipo: pretemporada (1), temporada regular (2), playoffs (3)
  let all = [];
  for (const t of [2, 1, 3]) {
    try {
      const sch = await getJson(`${BASE}/teams/por/schedule?seasontype=${t}`);
      all = all.concat(sch.events || []);
    } catch (e) { /* ignora */ }
  }
  const evs = all.filter((e) => {
    const st = e.competitions && e.competitions[0] && e.competitions[0].status;
    const state = st && st.type && st.type.state;
    return state === 'in' || state === 'post';
  });
  evs.sort((a, b) => new Date(b.date) - new Date(a.date));
  return evs[0] ? evs[0].id : null;
}

const num = (v) => {
  const n = parseFloat(String(v).replace('+', ''));
  return isNaN(n) ? 0 : n;
};
const split = (v) => {
  const p = String(v || '0-0').split('-');
  return [num(p[0]), num(p[1])];
};

function convertPlayers(block) {
  const out = [];
  const grp = (block.statistics || [])[0];
  if (!grp) return out;
  const keys = grp.keys || [];
  const ix = (k) => keys.indexOf(k);
  for (const a of grp.athletes || []) {
    if (a.didNotPlay || !a.stats || !a.stats.length) continue;
    const s = (k) => a.stats[ix(k)];
    const min = num(s('minutes'));
    const [fgm, fga] = split(s('fieldGoalsMade-fieldGoalsAttempted'));
    const [tpm, tpa] = split(s('threePointFieldGoalsMade-threePointFieldGoalsAttempted'));
    const [ftm, fta] = split(s('freeThrowsMade-freeThrowsAttempted'));
    const full = (a.athlete && (a.athlete.displayName || a.athlete.shortName)) || '';
    const sp = full.indexOf(' ');
    out.push({
      firstName: sp > 0 ? full.slice(0, sp) : full,
      familyName: sp > 0 ? full.slice(sp + 1) : '',
      name: full,
      jerseyNum: (a.athlete && a.athlete.jersey) || '',
      starter: a.starter ? '1' : '0',
      statistics: {
        minutesCalculated: 'PT' + Math.round(min) + 'M00S',
        points: num(s('points')),
        fieldGoalsMade: fgm, fieldGoalsAttempted: fga,
        threePointersMade: tpm, threePointersAttempted: tpa,
        freeThrowsMade: ftm, freeThrowsAttempted: fta,
        reboundsTotal: num(s('rebounds')),
        assists: num(s('assists')),
        steals: num(s('steals')),
        blocks: num(s('blocks')),
        turnovers: num(s('turnovers')),
        plusMinusPoints: num(s('plusMinus')),
      },
    });
  }
  return out;
}

function teamStats(teamEntry, playersBlock) {
  const m = {};
  for (const st of (teamEntry && teamEntry.statistics) || []) m[st.name] = st.displayValue;
  let [fgm, fga] = split(m['fieldGoalsMade-fieldGoalsAttempted']);
  let [tpm, tpa] = split(m['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
  let [ftm, fta] = split(m['freeThrowsMade-freeThrowsAttempted']);
  const o = {
    fieldGoalsMade: fgm, fieldGoalsAttempted: fga,
    threePointersMade: tpm, threePointersAttempted: tpa,
    freeThrowsMade: ftm, freeThrowsAttempted: fta,
    reboundsTotal: num(m.totalRebounds), assists: num(m.assists),
    steals: num(m.steals), blocks: num(m.blocks), turnovers: num(m.turnovers),
  };
  // respaldo: sumar jugadores si el equipo no trae stats
  if (!fga && playersBlock) {
    const ps = convertPlayers(playersBlock);
    for (const k of Object.keys(o)) o[k] = ps.reduce((t, p) => t + (p.statistics[k] || 0), 0);
  }
  return o;
}

function convert(sum) {
  const teams = (sum.boxscore && sum.boxscore.teams) || [];
  const players = (sum.boxscore && sum.boxscore.players) || [];
  const comp = (((sum.header || {}).competitions) || [])[0] || {};
  const build = (abbr) => {
    const te = teams.find((t) => t.team && t.team.abbreviation === abbr);
    const pb = players.find((p) => p.team && p.team.abbreviation === abbr);
    const cc = (comp.competitors || []).find((c) => c.team && c.team.abbreviation === abbr) || {};
    const t = (te && te.team) || (pb && pb.team) || {};
    return {
      teamTricode: tri(abbr),
      teamCity: t.location || '',
      teamName: t.name || t.displayName || '',
      score: num(cc.score),
      statistics: teamStats(te, pb),
      players: pb ? convertPlayers(pb) : [],
    };
  };
  const abbrs = teams.map((t) => t.team.abbreviation);
  const home = (teams.find((t) => t.homeAway === 'home') || teams[0]).team.abbreviation;
  const away = abbrs.find((a) => a !== home) || abbrs[1];
  return { game: { gameId: String((sum.header || {}).id || ''), homeTeam: build(home), awayTeam: build(away) } };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const q = String((req.query && req.query.gameId) || '');
    const id = /^\d{9}$/.test(q) ? q : await findEventId(); // ID de ESPN directo, o búsqueda automática
    if (!id) return res.status(404).json({ error: 'No encontré partido de Portland (hoy/últimos días).' });
    const sum = await getJson(`${BASE}/summary?event=${id}`);
    if (!sum.boxscore || !(sum.boxscore.players || []).length)
      return res.status(404).json({ error: 'El partido todavía no tiene box score.' });
    return res.status(200).json(convert(sum));
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}

module.exports = handler;
module.exports._convert = convert;
