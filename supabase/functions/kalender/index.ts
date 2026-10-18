// Kalenderabonnement (iCalendar) for samlingane.
// Supabase → Edge Functions → Deploy a new function → «kalender», lim inn denne fila.
// Slå AV «Verify JWT» for funksjonen, sidan kalenderappar ikkje kan logge inn.
// Tilgang styrast i staden av den hemmelege nøkkelen i lenkja (group_info.calendar_token).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BOOKS: Record<string, string> = {
  GEN: '1 Mosebok', EXO: '2 Mosebok', LEV: '3 Mosebok', NUM: '4 Mosebok', DEU: '5 Mosebok', JOS: 'Josva', JDG: 'Domarane', RUT: 'Rut',
  '1SA': '1 Samuelsbok', '2SA': '2 Samuelsbok', '1KI': '1 Kongebok', '2KI': '2 Kongebok', '1CH': '1 Krønikebok', '2CH': '2 Krønikebok',
  EZR: 'Esra', NEH: 'Nehemja', EST: 'Ester', JOB: 'Job', PSA: 'Salmane', PRO: 'Ordtøka', ECC: 'Forkynnaren', SNG: 'Høgsongen',
  ISA: 'Jesaja', JER: 'Jeremia', LAM: 'Klagesongane', EZK: 'Esekiel', DAN: 'Daniel', HOS: 'Hosea', JOL: 'Joel', AMO: 'Amos',
  OBA: 'Obadja', JON: 'Jona', MIC: 'Mika', NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Sefanja', HAG: 'Haggai', ZEC: 'Sakarja', MAL: 'Malaki',
  MAT: 'Matteus', MRK: 'Markus', LUK: 'Lukas', JHN: 'Johannes', ACT: 'Apostelgjerningane', ROM: 'Romarbrevet', '1CO': '1 Korintarbrev',
  '2CO': '2 Korintarbrev', GAL: 'Galatarbrevet', EPH: 'Efesarbrevet', PHP: 'Filipparbrevet', COL: 'Kolossarbrevet',
  '1TH': '1 Tessalonikarbrev', '2TH': '2 Tessalonikarbrev', '1TI': '1 Timoteusbrev', '2TI': '2 Timoteusbrev', TIT: 'Titusbrevet',
  PHM: 'Filemonbrevet', HEB: 'Hebrearbrevet', JAS: 'Jakobsbrevet', '1PE': '1 Petersbrev', '2PE': '2 Petersbrev',
  '1JN': '1 Johannesbrev', '2JN': '2 Johannesbrev', '3JN': '3 Johannesbrev', JUD: 'Judasbrevet', REV: 'Openberringa',
};

const TZ = ['BEGIN:VTIMEZONE', 'TZID:Europe/Oslo',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'];

const text = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => { const out = []; while (line.length > 72) { out.push(line.slice(0, 72)); line = ' ' + line.slice(72); } out.push(line); return out.join('\r\n'); };
const pad = (n: number) => String(n).padStart(2, '0');
// Rekn med «veggklokke»-tid i UTC-objekt, så tidssona til serveren ikkje spelar inn
const wall = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;

type Meeting = { id: string; date: string; time: string | null; book: string | null; ch_from: number | null; ch_to: number | null;
  verses: string | null; topic: string | null; host: string | null; note: string | null };

function ref(m: Meeting) {
  if (!m.book || !BOOKS[m.book]) return '';
  let s = BOOKS[m.book];
  if (m.ch_from) s += ' ' + (!m.ch_to || m.ch_to === m.ch_from ? m.ch_from : `${m.ch_from}–${m.ch_to}`);
  if (m.verses) s += ',' + m.verses;
  return s;
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: info } = await sb.from('group_info').select('name, calendar_token').eq('id', 1).maybeSingle();
  if (!token || !info?.calendar_token || token !== info.calendar_token) return new Response('Ugyldig kalenderlenkje', { status: 403 });

  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  const [{ data: meetings }, { data: members }] = await Promise.all([
    sb.from('meetings').select('*').gte('date', since).order('date'),
    sb.from('members').select('name, address, postcode, place'),
  ]);

  const name = info.name || 'Dirdal Unge Mannsforening';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dirdal Unge Mannsforening//Bibelgruppe//NN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + text(name), 'X-WR-TIMEZONE:Europe/Oslo', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H', ...TZ];

  for (const m of (meetings ?? []) as Meeting[]) {
    const r = ref(m);
    const host = m.host?.trim();
    const mem = (members ?? []).find((x) => host && x.name.toLowerCase() === host.toLowerCase());
    lines.push('BEGIN:VEVENT', `UID:${m.id}@dirdal-umf`, `DTSTAMP:${stamp}`);
    if (m.time) {
      const [hh, mm] = m.time.slice(0, 5).split(':').map(Number);
      const start = new Date(`${m.date}T00:00:00Z`); start.setUTCHours(hh, mm);
      const end = new Date(start.getTime() + 2 * 36e5);
      lines.push(`DTSTART;TZID=Europe/Oslo:${wall(start)}`, `DTEND;TZID=Europe/Oslo:${wall(end)}`);
    } else {
      const d = new Date(`${m.date}T00:00:00Z`), e = new Date(d.getTime() + 864e5);
      lines.push(`DTSTART;VALUE=DATE:${wall(d).slice(0, 8)}`, `DTEND;VALUE=DATE:${wall(e).slice(0, 8)}`);
    }
    lines.push('SUMMARY:' + text(name + (r ? ': ' + r : '')));
    const url = m.book && m.ch_from ? `https://bibel.no/nettbibelen/les/nn-2011/${m.book}/${m.book}.${m.ch_from}` : '';
    const desc = [r && 'Les: ' + r, url && 'På nett: ' + url, m.topic, host && 'Hos ' + host, m.note].filter(Boolean).join('\n');
    if (desc) lines.push('DESCRIPTION:' + text(desc));
    if (host) {
      const addr = mem?.address ? `, ${mem.address}, ${[mem.postcode, mem.place].filter(Boolean).join(' ')}` : '';
      lines.push('LOCATION:' + text(host + addr));
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="dirdal-umf.ics"', 'Cache-Control': 'max-age=300' },
  });
});
