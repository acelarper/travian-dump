'use strict';
(() => {
  const SERVER = 'https://ts12.x1.europe.travian.com';
  const ALLIANCES = ['L!', 'L#', 'L*'];
  const MAP_LIMIT = 40 * 1024 * 1024;
  const TRIBES = {
    1: {name:'Romans', units:[['Legionnaire',6],['Praetorian',5],['Imperian',7],['Equites Legati',16],['Equites Imperatoris',14],['Equites Caesaris',10],['Battering Ram',4],['Fire Catapult',3],['Senator',4],['Settler',5]]},
    2: {name:'Teutons', units:[['Clubswinger',7],['Spearman',7],['Axeman',6],['Scout',9],['Paladin',10],['Teutonic Knight',9],['Ram',4],['Catapult',3],['Chief',4],['Settler',5]]},
    3: {name:'Gauls', units:[['Phalanx',7],['Swordsman',6],['Pathfinder',17],['Theutates Thunder',19],['Druidrider',16],['Haeduan',13],['Ram',4],['Trebuchet',3],['Chieftain',5],['Settler',5]]}
  };
  for (const tribe of Object.values(TRIBES)) {
    tribe.units = tribe.units.map(([name, speed], index) => ({id:index + 1, name, speed}));
  }
  const DEFENCE_SLOTS = {
    1:{infantry:[3,2],cavalry:[]},
    2:{infantry:[2],cavalry:[5]},
    3:{infantry:[1],cavalry:[5]}
  };
  const integer = (n, min, max, name) => {
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    return n;
  };
  function parseMapSql(text) {
    if (typeof text !== 'string' || text.length > MAP_LIMIT) throw new Error('Map must be a text file smaller than 40 MB.');
    let pos = 0;
    const villages = [], ids = new Set(), tiles = new Set();
    const fail = message => { throw new Error(`Invalid map.sql near character ${pos + 1}: ${message}. No data was replaced.`); };
    const space = () => {
      for (;;) {
        while (pos < text.length && /\s/.test(text[pos])) pos++;
        if (text.startsWith('--', pos) || text[pos] === '#') {
          while (pos < text.length && text[pos] !== '\n') pos++;
        } else if (text.startsWith('/*', pos)) {
          const end = text.indexOf('*/', pos + 2);
          if (end < 0) fail('unfinished comment');
          pos = end + 2;
        } else break;
      }
    };
    const token = () => {
      space();
      if (text[pos] === "'") {
        pos++;
        let value = '';
        while (pos < text.length) {
          const ch = text[pos++];
          if (ch === "'") {
            if (text[pos] === "'") { value += "'"; pos++; }
            else return value;
          } else if (ch === '\\') {
            if (pos >= text.length) fail('unfinished string escape');
            const escaped = text[pos++];
            const escapes = {'0':'\0', b:'\b', n:'\n', r:'\r', t:'\t', Z:'\x1a'};
            value += Object.hasOwn(escapes, escaped) ? escapes[escaped] : escaped;
          } else value += ch;
        }
        fail('unfinished quoted name');
      }
      const start = pos;
      while (pos < text.length && !/[\s,)]/.test(text[pos])) pos++;
      const value = text.slice(start, pos);
      if (/^-?\d+$/.test(value)) {
        const n = Number(value);
        if (!Number.isSafeInteger(n)) fail('integer is out of range');
        return n;
      }
      if (/^NULL$/i.test(value)) return null;
      if (/^(TRUE|FALSE)$/i.test(value)) return value.toUpperCase() === 'TRUE';
      fail('unsupported value');
    };
    const insert = /INSERT\s+INTO\s+(?:`x_world`|x_world)\s+VALUES\s*/iy;
    space();
    while (pos < text.length) {
      insert.lastIndex = pos;
      const match = insert.exec(text);
      if (!match) fail('expected INSERT INTO x_world VALUES');
      pos = insert.lastIndex;
      for (;;) {
        space();
        if (text[pos++] !== '(') fail('expected a village row');
        const row = [];
        for (;;) {
          row.push(token());
          if (row.length > 40) fail('too many columns');
          space();
          const separator = text[pos++];
          if (separator === ')') break;
          if (separator !== ',') fail('expected comma or closing parenthesis');
        }
        if (row.length < 11) fail('at least 11 village columns are required');
        const [tileId,x,y,tribe,did,name,uid,player,aid,alliance,population] = row;
        integer(tileId,1,160801,'Map tile ID');
        integer(x,-200,200,'Village X'); integer(y,-200,200,'Village Y');
        integer(tribe,1,9,'Tribe'); integer(did,1,1e12,'Village ID');
        integer(uid,0,1e12,'Player ID'); integer(aid,0,1e12,'Alliance ID');
        integer(population,0,1e9,'Population');
        if ([name,player,alliance].some(value => typeof value !== 'string')) fail('village, player and alliance names must be quoted');
        if (!name || !player || [name,player,alliance].some(value => value.length > 1000)) fail('invalid name');
        if (ids.has(did) || tiles.has(`${x}|${y}`)) fail('duplicate village ID or coordinates');
        ids.add(did); tiles.add(`${x}|${y}`);
        villages.push({tileId,x,y,tribe,did,name,uid,player,aid,alliance,population});
        if (villages.length > 160801) fail('too many villages for TS12');
        space();
        if (text[pos] !== ',') break;
        pos++;
      }
      if (text[pos++] !== ';') fail('expected semicolon');
      space();
    }
    if (!villages.length) throw new Error('No villages found. Select the TS12 map.sql export, not an HTML login or error page.');
    return villages;
  }
  function playersFromMap(villages) {
    const players = new Map();
    for (const village of villages) {
      if (!ALLIANCES.includes(village.alliance) || !village.uid) continue;
      if (!players.has(village.uid)) players.set(village.uid, {id:village.uid, name:village.player, alliances:new Set(), villages:[]});
      const player = players.get(village.uid);
      player.alliances.add(village.alliance);
    }
    for (const village of villages) {
      const player = players.get(village.uid);
      if (player) player.villages.push(village);
    }
    return [...players.values()].sort((a,b) => a.name.localeCompare(b.name,undefined,{numeric:true}));
  }
  function parseCsvTable(text,required) {
    if (typeof text !== 'string' || text.length > MAP_LIMIT) throw new Error('CSV must be a text file smaller than 40 MB.');
    text = text.replace(/^\uFEFF/,'');
    const records = [];
    let fields = [], field = '', quoted = false, closed = false;
    const endField = () => { fields.push(field); field = ''; closed = false; };
    const endRow = () => {
      endField();
      if (fields.some(value => value.trim())) records.push(fields);
      fields = [];
    };
    for (let i=0;i<text.length;i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i+1] === '"') { field += '"'; i++; }
          else { quoted = false; closed = true; }
        } else field += ch;
        continue;
      }
      if (closed && (ch === ' ' || ch === '\t')) continue;
      if (closed && ![',','\r','\n'].includes(ch)) throw new Error(`Invalid CSV near character ${i+1}: unexpected text after a quote.`);
      if (ch === '"') {
        if (field) throw new Error(`Invalid CSV near character ${i+1}: unexpected quote.`);
        quoted = true;
      } else if (ch === ',') endField();
      else if (ch === '\r' || ch === '\n') {
        endRow();
        if (ch === '\r' && text[i+1] === '\n') i++;
      } else field += ch;
    }
    if (quoted) throw new Error('Invalid CSV: unfinished quoted field.');
    if (field || closed || fields.length) endRow();
    if (records.length < 2) throw new Error('CSV must contain a header and at least one village.');
    const headers = records[0].map(value => value.trim().toLowerCase());
    if (new Set(headers).size !== headers.length || headers.some(value => !value)) throw new Error('CSV contains empty or duplicate column names.');
    const missing = required.filter(name => !headers.includes(name));
    if (missing.length) throw new Error(`Missing CSV columns: ${missing.join(', ')}.`);
    const columns = new Map(headers.map((name,index) => [name,index]));
    return records.slice(1).map((record,index) => {
      const row = index+2;
      if (record.length !== headers.length) throw new Error(`CSV row ${row}: expected ${headers.length} columns, found ${record.length}.`);
      return {row,cell:name => columns.has(name) ? record[columns.get(name)].trim() : ''};
    });
  }
  function parseTravcoCsv(text) {
    const required = ['travian_account','village_name','x','y','ts_percentage','troop_count1','troop_count2','troop_count3','troop_count5'];
    const seen = new Set();
    return parseCsvTable(text,required).map(({row,cell}) => {
      const number = (name,min,max) => {
        const value = cell(name);
        if (!/^[+-]?\d+$/.test(value)) throw new Error(`CSV row ${row}: ${name} must be a whole number.`);
        return integer(Number(value),min,max,`CSV row ${row}: ${name}`);
      };
      const player = cell('travian_account'), name = cell('village_name');
      if (!player || !name || player.length > 200 || name.length > 200) throw new Error(`CSV row ${row}: invalid player or village name.`);
      const x = number('x',-200,200), y = number('y',-200,200);
      const key = `${x}|${y}`;
      if (seen.has(key)) throw new Error(`CSV row ${row}: duplicate village at (${key}).`);
      seen.add(key);
      const tsPercentage = number('ts_percentage',100,500);
      if ((tsPercentage-100)%20) throw new Error(`CSV row ${row}: TS percentage must be 100, 120, ... 500.`);
      const counts = {};
      for (const slot of [1,2,3,5]) counts[slot] = number(`troop_count${slot}`,0,1e9);
      return {row,player,name,x,y,ts:(tsPercentage-100)/20,tsPercentage,counts};
    });
  }
  const accountKey = name => name.normalize('NFC').toLocaleLowerCase();
  function makeLeaderRoster(rows,villages) {
    const byCoordinates = new Map(villages.map(v => [`${v.x}|${v.y}`,v]));
    const accounts = new Map();
    for (const village of villages) {
      const key = accountKey(village.player), previous = accounts.get(key);
      if (!accounts.has(key)) accounts.set(key,village);
      else if (previous && (previous.uid !== village.uid || previous.tribe !== village.tribe)) accounts.set(key,null);
    }
    const candidates = [], warnings = [];
    for (const row of rows) {
      const origin = byCoordinates.get(`${row.x}|${row.y}`);
      const description = `CSV row ${row.row}, ${row.player} / ${row.name} ${coordText(row)}`;
      if (!origin) { warnings.push(`${description}: missing from map.sql; skipped.`); continue; }
      const sameOwner = accountKey(origin.player) === accountKey(row.player);
      const account = sameOwner ? origin : accounts.get(accountKey(row.player));
      const tribe = account ? account.tribe : origin.tribe;
      if (!sameOwner) warnings.push(`${description}: owner differs from map.sql; verify the CSV/map match.${!account ? ' Player link unavailable; tribe taken from the coordinates.' : ''}`);
      const slots = DEFENCE_SLOTS[tribe];
      if (!slots) { warnings.push(`${description}: unsupported tribe ${tribe}; skipped.`); continue; }
      const troops = [];
      for (const [category,minimum] of [['infantry',1000],['cavalry',500]]) {
        const total = slots[category].reduce((sum,id) => sum+row.counts[id],0);
        if (total < minimum) continue;
        for (const id of slots[category]) {
          if (row.counts[id]) troops.push({...TRIBES[tribe].units[id-1],count:row.counts[id]});
        }
      }
      if (troops.length) candidates.push({origin:{...origin,tribe,uid:account ? account.uid : null,aid:account ? account.aid : 0,name:row.name,player:row.player,mapOwnerMismatch:!sameOwner},ts:row.ts,
        tsPercentage:row.tsPercentage,troops,total:troops.reduce((sum,troop) => sum+troop.count,0)});
    }
    candidates.sort((a,b) => b.total-a.total || a.origin.player.localeCompare(b.origin.player) || a.origin.did-b.origin.did);
    return {candidates,warnings,rowCount:rows.length};
  }
  function parseCoordinates(value) {
    const normalized = value.trim().replace(/\u2212/g,'-');
    const bare = normalized.startsWith('(') && normalized.endsWith(')') ? normalized.slice(1,-1) : normalized;
    const match = /^([+-]?\d+)(?:\s*[|,]\s*|\s+)([+-]?\d+)$/.exec(bare.trim());
    if (!match) throw new Error('Enter target coordinates as (x|y), x,y or x y.');
    return {x:integer(Number(match[1]),-200,200,'Target X'), y:integer(Number(match[2]),-200,200,'Target Y')};
  }
  const fold = text => text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().trim();
  const isCoordinateQuery = text => /^[+\-\d|,()\s]+$/.test(text) && /[|,\s]/.test(text);
  const targetLabel = village => `${village.player} / ${village.name} (${village.x}|${village.y})`;
  function createTargetIndex(villages) {
    return villages.map(village => ({village,name:fold(village.name),player:fold(village.player),
      label:fold(targetLabel(village)),alliance:fold(village.alliance),coords:`${village.x}|${village.y}`}));
  }
  function searchTargets(index,query,limit = 12) {
    const text = fold(query).replace(/\u2212/g,'-');
    if (!text) return {matches:[],count:0};
    const tokens = text.split(/\s+/);
    const coordinateSearch = isCoordinateQuery(text);
    let coordinates = text.replace(/[()]/g,'').trim().replace(/\s*[|,]\s*|\s+/g,'|').replace(/(^|\|)\+/g,'$1');
    const parts = coordinates.split('|');
    if (parts.length === 2 && parts.every(p => /^-?\d+$/.test(p))) coordinates = parts.map(Number).join('|');
    const matches = [];
    for (const entry of index) {
      if (coordinateSearch ? !entry.coords.startsWith(coordinates) : !tokens.every(token => entry.label.includes(token) || entry.alliance.includes(token))) continue;
      const score = entry.coords === coordinates ? 0 : entry.name === text || entry.player === text ? 1
        : entry.name.startsWith(text) || entry.player.startsWith(text) ? 2 : 3;
      matches.push({entry,score});
    }
    matches.sort((a,b) => a.score-b.score || a.entry.player.localeCompare(b.entry.player)
      || a.entry.name.localeCompare(b.entry.name,undefined,{numeric:true}) || a.entry.village.did-b.entry.village.did);
    return {matches:matches.slice(0,limit).map(match => match.entry.village),count:matches.length};
  }
  function resolveTarget(index,query) {
    const text = query.trim().replace(/\u2212/g,'-');
    if (isCoordinateQuery(text)) return parseCoordinates(text);
    const normalized = fold(text);
    const matches = index.filter(entry => entry.name === normalized || entry.player === normalized || entry.label === normalized);
    if (matches.length !== 1) throw new Error(matches.length ? 'Choose a village from the target suggestions.' : 'Select a target village or enter (x|y).');
    const {x,y} = matches[0].village;
    return {x,y};
  }
  function normalizeClockTime(value) {
    let text = value.trim();
    if (/[^\d\s:.,+\-\u2212]/.test(text)) {
      const candidates = text.match(/(?:[+\-\u2212]\s*)?[.,]?\d[\d:.,]*/g) || [];
      if (candidates.length !== 1) throw new Error('Enter one attack time, such as 13:10:01.');
      text = candidates[0];
    }
    const match = /^(\d+)(?::([0-5]?\d)(?::([0-5]?\d)(?:\.(\d{1,3}))?)?)?$/.exec(text);
    if (!match) throw new Error('Use H, H:MM or H:MM:SS. Minutes and seconds must be 00-59.');
    const hour = integer(Number(match[1]),0,23,'Attack hour');
    const clock = [hour,Number(match[2] || 0),Number(match[3] || 0)].map(n => String(n).padStart(2,'0')).join(':');
    const fraction = (match[4] || '').padEnd(3,'0');
    return clock + (Number(fraction) ? '.'+fraction : '');
  }
  function parseUTC(value, name = 'UTC time') {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
    if (!match) throw new Error(`${name}: enter a full UTC date and time.`);
    const [,year,month,day,hour,minute,seconds = '0',fraction = ''] = match;
    const parts = [year,month,day,hour,minute,seconds].map(Number);
    if (parts[0] < 1000 || parts[0] > 9999) throw new Error(`${name}: invalid year.`);
    const ms = Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]);
    const date = new Date(ms);
    const actual = [date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds()];
    if (parts.some((part,index) => part !== actual[index])) throw new Error(`${name}: invalid calendar date or time.`);
    return ms + Number(fraction.padEnd(3,'0'));
  }
  const isoTime = ms => new Date(ms).toISOString().replace(/\.000Z$/,'').replace(/Z$/,'');
  const formatUTC = ms => isoTime(ms).replace('T',' ') + ' UTC';
  const formatClock = ms => isoTime(ms).slice(11);
  const dayFormatter = new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
  const formatDay = ms => dayFormatter.format(new Date(ms));
  const coordText = village => `(${village.x}|${village.y})`;
  function travcoCallTimestamp(day,month,year,time,sourceMs,offsetMinutes = 0) {
    day = integer(Number(day),1,31,'Call day'); month = integer(Number(month),1,12,'Call month');
    const timestamp = y => parseUTC(`${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${time}`,'Call time')-offsetMinutes*60000;
    if (year) {
      if (!/^\d{4}$/.test(year)) throw new Error('Use a four-digit year, or omit the year.');
      return integer(timestamp(year),0,253402300799999,'Call time');
    }
    if (sourceMs === null) throw new Error('Include the Travco page clock so the year is known, or use deadlines with a four-digit year.');
    const currentYear = new Date(sourceMs).getUTCFullYear();
    const candidates = [currentYear,currentYear-1,currentYear+1]
      .filter(y => y >= 1970 && y <= 9999 && day <= new Date(Date.UTC(y,month,0)).getUTCDate())
      .map(timestamp).filter(ms => ms >= 0 && ms <= 253402300799999)
      .sort((a,b) => Math.abs(a-sourceMs)-Math.abs(b-sourceMs) || a-b);
    if (!candidates.length) throw new Error('Invalid call calendar date.');
    return candidates[0];
  }
  function parseDiscordDefenceCalls(text,referenceMs) {
    integer(referenceMs,0,253402300799999,'Current UTC time');
    const clean = text.replace(/\*\*|__|`/g,'').replace(/\u2212/g,'-').replace(/[^\S\n]+/g,' ')
      .replace(/^[> ]+/gm,'').replace(/ *\n */g,'\n').replace(/\n{2,}/g,'\n');
    const coordinates = /(?:^|\b(?:Defender )?Village[: *_]*\n?)[ *_]*\(? ?([+-]?\d{1,4}) ?[/|,] ?([+-]?\d{1,4}) ?\)?(?![\d/|,])(?=$|[\s:*_\u2013\u2014-])/gim;
    const impact = /\b(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d{1,3})?))?(?:[ \n]*,[ \n]*|[ \n]+)(\d{1,2})\.(\d{1,2})(?:\.(\d{1,4}))?\.?(?![\d.])/g;
    const blocks = clean.split(/\bNew\s+defen[sc]e\s+call\b/i,1002);
    if (blocks.length > 1001) throw new Error('At most 1,000 calls can be pasted at once.');
    if (blocks.length > 1 && blocks[0].search(coordinates) < 0 && blocks[0].search(impact) < 0
      && !/^(?:Village|Impact time)\b/im.test(blocks[0])) blocks.shift();
    if (blocks.length > 1000) throw new Error('At most 1,000 calls can be pasted at once.');
    const oneMatch = (value,pattern,name) => {
      const matches = value.matchAll(pattern), first = matches.next();
      if (first.done) throw new Error(`Missing ${name}.`);
      if (!matches.next().done) throw new Error(`More than one ${name}; keep each call's New defense call heading.`);
      return first.value;
    };
    const calls = new Map(), warnings = [];
    let rows = 0;
    for (const [index,block] of blocks.entries()) {
      try {
        const footer = /^(?:Troops needed|Troops missing|Send troops|Defen[sc]e calls|Confirm troops sent|Note)\b/im.exec(block);
        const body = footer ? block.slice(0,footer.index) : block;
        const location = oneMatch(body,coordinates,'village coordinates');
        const match = oneMatch(body,impact,'impact date/time');
        if (/[\d:+-]/.test(body[match.index-1] || '')) throw new Error('Invalid impact time.');
        const point = parseCoordinates(`${location[1]}|${location[2]}`);
        const time = normalizeClockTime(`${match[1]}:${match[2]}:${match[3] || '00'}`);
        const suffix = body.slice(match.index+match[0].length).trimStart()
          .replace(/^[-\u2013\u2014] *(?=[A-Za-z])/,'');
        let offset = 0;
        if (/^(?:UTC|GMT|Z\b|[+-]\d)/i.test(suffix)) {
          const zone = /^(?:(?:UTC|GMT)\s*)?([+-])\s*(\d{1,2})(?::?(\d{2}))?(?=$|[\s*_),;])/i.exec(suffix);
          const zero = /^(?:UTC|GMT|Z)(?=$|[\s*_),;])/i.exec(suffix);
          if (zone) {
            const hours = integer(Number(zone[2]),0,14,'UTC offset hour'), minutes = integer(Number(zone[3] || 0),0,59,'UTC offset minute');
            if (hours === 14 && minutes) throw new Error('UTC offset exceeds 14 hours.');
            offset = (hours*60+minutes)*(zone[1] === '-' ? -1 : 1);
          } else if (!zero || /^[+-]/.test(suffix.slice(zero[0].length).trimStart())
            || /^[\d:]/.test(suffix.slice(zero[0].length).split('\n')[0].trim())) {
            throw new Error('Invalid UTC offset.');
          }
        } else if (/^(?:CET|CEST|EET|EEST|BST|PST|PDT|EST|EDT|CST|CDT|MSK)\b/i.test(suffix)) {
          throw new Error('Use UTC or an explicit UTC offset.');
        }
        const deadlineMs = travcoCallTimestamp(match[4],match[5],match[6],time,referenceMs,offset);
        const end = location.index+location[0].length;
        const nameEnd = match.index >= end ? match.index : body.length;
        const villageName = body.slice(end,nameEnd).split('\n')[0].split(/\bImpact\s+time\b/i)[0]
          .replace(/^[ :\-\u2013\u2014]+/,'').trim().replace(/^\*(.*)\*$/,'$1').replace(/^_(.*)_$/,'$1');
        if (villageName.length > 200) throw new Error('Village name is too long.');
        const key = `impact:${point.x}|${point.y}@${deadlineMs}`;
        // The Discord footer can name the caller, not the village owner.
        if (!calls.has(key)) calls.set(key,{key,player:'',alliance:'',villageName,...point,deadlineMs,isImpact:true});
        rows++;
      } catch (error) { warnings.push(`Call ${index+1}: ${error.message}`); }
    }
    if (!calls.size) throw new Error(warnings[0] || 'Include village coordinates and an impact date/time.');
    return {calls:[...calls.values()].sort((a,b) => a.deadlineMs-b.deadlineMs || a.key.localeCompare(b.key)),
      rows,duplicates:rows-calls.size,reportedCount:null,sourceMs:null,warnings};
  }
  function parseTravcoDefenceCalls(input,referenceMs = Date.now()) {
    if (typeof input !== 'string' || input.length > MAP_LIMIT) throw new Error('Travco text must be smaller than 40 MB.');
    const text = input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ')
      .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\uFEFF]/g,'');
    const section = /^[ \t]*Defen[sc]e[ \t]+calls(?:[ \t]*\(?(\d+)\)?)?[ \t]*$/im.exec(text);
    const pageHeadings = /Defender\s+alliance\s+Defender\s+village\b/i.test(text);
    if (!pageHeadings && (section?.[1] === undefined || /\bNew\s+defen[sc]e\s+call\b|\bImpact\s+time\b/i.test(text))) {
      return parseDiscordDefenceCalls(text,referenceMs);
    }
    if (!section) throw new Error('Paste the Travco Defense calls page, including its table headings.');
    const reportedCount = section[1] === undefined ? null : integer(Number(section[1]),0,100000,'Reported call count');
    const pad = value => String(value).padStart(2,'0');
    const clock = (hour,minute,second,meridian) => {
      let h = Number(hour);
      if (meridian) h = integer(h,1,12,'Clock hour')%12+(meridian.toLowerCase() === 'p' ? 12 : 0);
      return normalizeClockTime(`${pad(h)}:${minute}:${second || '00'}`);
    };
    let sourceMs = null;
    for (const line of text.slice(0,section.index).split('\n')) {
      if (line.trim().length > 100) continue;
      const us = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?\s*(?:UTC)?\s*$/i.exec(line);
      const iso = /^\s*(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)\s*(?:Z|UTC)?\s*$/i.exec(line);
      if (us) sourceMs = parseUTC(`${us[3]}-${pad(us[1])}-${pad(us[2])}T${clock(us[4],us[5],us[6],us[7])}`,'Travco page clock');
      else if (iso) sourceMs = parseUTC(`${iso[1]}T${normalizeClockTime(iso[2])}`,'Travco page clock');
    }
    if (sourceMs !== null) integer(sourceMs,0,253402300799999,'Travco page clock');
    let body = text.slice(section.index+section[0].length);
    const footer = /^[ \t]*results on page[ \t]*:/im.exec(body);
    if (footer) body = body.slice(0,footer.index);
    const header = /Defender\s+Defender\s+alliance\s+Defender\s+village\s+Send\s+defen[sc]e\s+before\b/i.exec(body);
    if (!header) {
      if (reportedCount === 0) return {calls:[],rows:0,duplicates:0,reportedCount,sourceMs};
      throw new Error('The Defender / Defender village / Send defense before headings are missing.');
    }
    const deadline = value => {
      if (value.trim().length > 100) throw new Error('Invalid call deadline text.');
      const match = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d{1,3})?))?\s*(?:([ap])\.?\s*m\.?)?\s*,\s*(\d{1,2})\.(\d{1,2})\.(?:(\d{4})\.?)?\s*(?:UTC|Z)?$/i.exec(value.trim());
      if (!match) throw new Error('Use a Travco deadline such as 09:53:33, 09.11.');
      const time = clock(match[1],match[2],match[3],match[4]);
      return travcoCallTimestamp(match[5],match[6],match[7],time,sourceMs);
    };
    const coordinate = /^\(?\s*[+\-\u2212]?\d+\s*[/|,]\s*[+\-\u2212]?\d+\s*\)?$/;
    const startsTime = /^\d{1,2}:\d{2}/;
    const dateOnly = /^\d{1,2}\.\d{1,2}\.(?:\d{4}\.?)?\s*(?:UTC|Z)?$/i;
    const calls = new Map();
    let rows = 0;
    const add = (name,alliance,coords,time,row) => {
      try {
        const player = name.replace(/^tribe icon\s*/i,'').trim();
        if (!player || player.length > 200 || alliance.length > 200) throw new Error('Invalid defender name or alliance.');
        const point = parseCoordinates(coords.replace(/\//g,'|')), deadlineMs = deadline(time);
        const key = `${point.x}|${point.y}@${deadlineMs}`;
        if (!calls.has(key)) calls.set(key,{key,player,alliance,...point,deadlineMs});
        rows++;
        if (rows > 1000) throw new Error('At most 1,000 calls can be pasted at once.');
      } catch (error) { throw new Error(`Call row ${row}: ${error.message}`); }
    };
    const lines = body.split('\n');
    const headerLine = lines.findIndex(line => /Defender\s+village/i.test(line) && /Send\s+defen[sc]e\s+before/i.test(line));
    const columns = headerLine < 0 ? [] : lines[headerLine].split('\t').map(cell => cell.trim().toLowerCase().replace(/\s+/g,' '));
    const playerColumn = columns.indexOf('defender'), allianceColumn = columns.indexOf('defender alliance');
    const coordinateColumn = columns.indexOf('defender village'), timeColumn = columns.findIndex(cell => /^send defen[sc]e before$/.test(cell));
    if ([playerColumn,allianceColumn,coordinateColumn,timeColumn].every(index => index >= 0)) {
      for (let i=headerLine+1;i<lines.length;i++) {
        const cells = lines[i].split('\t').map(cell => cell.trim());
        const name = cells[playerColumn] || '', coords = cells[coordinateColumn] || '';
        let time = cells[timeColumn] || '';
        if (name.toLowerCase() === 'tribe icon') continue;
        if (!coordinate.test(coords) && !startsTime.test(time) && !/^tribe icon\s+\S/i.test(name)) continue;
        const row = i+1, next = (lines[i+1] || '').split('\t')[0].trim();
        if (/,\s*$/.test(time) && dateOnly.test(next)) { time += ' '+next; i++; }
        add(name,cells[allianceColumn] || '',coords,time,row);
      }
    } else {
      const tokens = body.slice(header.index+header[0].length).split(/[\t\n]+/).map(value => value.trim())
        .filter(value => value && value.toLowerCase() !== 'tribe icon');
      for (let i=2;i<tokens.length-1;i++) {
        if (!coordinate.test(tokens[i])) continue;
        let time = tokens[i+1], consumed = 1;
        if (!startsTime.test(time) && !/^tribe icon\s+\S/i.test(tokens[i-2])) continue;
        if (/,\s*$/.test(time) && dateOnly.test(tokens[i+2] || '')) { time += ' '+tokens[i+2]; consumed++; }
        add(tokens[i-2],tokens[i-1],tokens[i],time,rows+1);
        i += consumed;
      }
    }
    if (!rows && reportedCount !== 0) throw new Error('No readable defence calls found. Include the complete table rows.');
    return {calls:[...calls.values()].sort((a,b) => a.deadlineMs-b.deadlineMs || a.player.localeCompare(b.player)),
      rows,duplicates:rows-calls.size,reportedCount,sourceMs};
  }
  function distance(a,b) {
    for (const point of [a,b]) {
      integer(point.x,-200,200,'X'); integer(point.y,-200,200,'Y');
    }
    const dx = Math.abs(a.x-b.x), dy = Math.abs(a.y-b.y);
    return Math.hypot(Math.min(dx,401-dx),Math.min(dy,401-dy));
  }
  function movementSeconds(fields,speed,ts,boots,itemMultiplier,artefact = 1) {
    if (!Number.isFinite(fields) || fields < 0 || !Number.isFinite(speed) || speed <= 0) throw new Error('Invalid distance or troop speed.');
    integer(ts,0,20,'Tournament Square');
    if (![0,0.25,0.5,0.75].includes(boots)) throw new Error('Unsupported movement bonus.');
    const weightedDistance = Math.min(fields,20) + Math.max(fields-20,0)/(1+0.2*ts+boots);
    // Keep item/artefact multiplication order stable at half-second boundaries.
    return 3600*weightedDistance/(speed*itemMultiplier*artefact);
  }
  function travelSeconds(fields,speed,ts,boots = 0,hand = 1) {
    if (![1,1.15].includes(hand)) throw new Error('Unsupported movement bonus.');
    return Math.round(movementSeconds(fields,speed,ts,boots,hand));
  }
  function returnSeconds(fields,speed,ts,boots = 0,mapBonus = 0,artefact = 1) {
    if (![0,30,40,50].includes(mapBonus)) throw new Error('Unsupported return map bonus.');
    if (![1,1.5,2].includes(artefact)) throw new Error('Unsupported return speed artefact.');
    // Maps multiply return speed, not reduce time by the displayed percentage.
    return Math.round(movementSeconds(fields,speed,ts,boots,1+mapBonus/100,artefact));
  }
  const emptyHero = () => ({solo:false});
  const emptyVillage = village => ({did:village.did,tribe:village.tribe,x:village.x,y:village.y,enabled:false,ts:0,defenders:[],escorts:[]});
  const makeProfile = player => ({playerId:player.id,villages:player.villages.map(emptyVillage),hero:emptyHero()});
  function validateProfile(profile,villages) {
    integer(profile.playerId,1,1e12,'Account ID');
    if (!Array.isArray(profile.villages) || profile.villages.length > 1000) throw new Error('Invalid saved village settings.');
    const owned = new Map(villages.filter(v => v.uid === profile.playerId).map(v => [v.did,v]));
    const seen = new Set();
    for (const config of profile.villages) {
      if (!config || !owned.has(config.did) || seen.has(config.did)) throw new Error('A saved village is missing, duplicated or no longer owned by this account. No settings were replaced.');
      seen.add(config.did);
      const village = owned.get(config.did);
      if (config.tribe !== village.tribe || config.x !== village.x || config.y !== village.y) throw new Error(`Saved village ${village.name} no longer matches this map.`);
      if (typeof config.enabled !== 'boolean') throw new Error('Invalid anvil selection.');
      integer(config.ts,0,20,`Tournament Square for ${village.name}`);
      if (config.enabled && !Object.hasOwn(TRIBES,village.tribe)) throw new Error(`Tribe ${village.tribe} is not supported on this TS12 planner.`);
      for (const [key,max] of [['defenders',6],['escorts',10]]) {
        const values = config[key];
        if (!Array.isArray(values) || values.length > max || new Set(values).size !== values.length) throw new Error(`Invalid ${key} for ${village.name}.`);
        values.forEach(id => integer(id,1,max,'Troop slot'));
      }
    }
    const hero = profile.hero;
    if (!hero || typeof hero.solo !== 'boolean') throw new Error('Invalid hero-only setting.');
    return profile;
  }
  function relationship(origin,target) {
    if (target && target.uid === origin.uid) return 'own';
    if (target && origin.aid !== 0 && origin.aid === target.aid) return 'alliance';
    return 'confederacy';
  }
  function heroVariants(origin,relation) {
    const variants = [{withHero:false,label:'No hero',speed:Infinity,boots:0,hand:1}];
    const heroSpeed = 14 + (origin.tribe === 3 ? 5 : 0);
    const boots = [{name:'',bonus:0},{name:'Mercenary boots',bonus:0.25}];
    const hands = [{name:'',bonus:1}];
    if (['alliance','confederacy'].includes(relation)) hands.push({name:'Small Standard',bonus:1.15});
    for (const boot of boots) for (const hand of hands) {
      const items = [boot.name,hand.name].filter(Boolean);
      variants.push({withHero:true,label:items.join(' + ') || 'No speed items',speed:heroSpeed,boots:boot.bonus,hand:hand.bonus});
    }
    return variants;
  }
  function makeLoads(config,hero) {
    const units = TRIBES[config.tribe].units;
    const defenders = units.filter(u => config.defenders.includes(u.id));
    const escorts = units.filter(u => config.escorts.includes(u.id));
    const loads = [];
    for (const speed of new Set(defenders.map(u => u.speed))) {
      const anchors = defenders.filter(u => u.speed === speed);
      const faster = defenders.filter(u => u.speed > speed);
      loads.push({key:`def-${speed}`,speed,label:anchors.map(u => u.name).join(' or '),
        detail:faster.length ? `Can add: ${faster.map(u => u.name).join(', ')}.` : '',
        defenderIds:[...anchors,...faster].map(u => u.id),requiredIds:anchors.map(u => u.id),escortIds:[],requiresHero:false});
    }
    for (const speed of new Set(escorts.map(u => u.speed))) {
      const faster = defenders.filter(u => u.speed > speed);
      if (!faster.length) continue;
      const choices = escorts.filter(u => u.speed === speed);
      loads.push({key:`escort-${speed}`,speed,label:`${faster.map(u => u.name).join(' / ')} + 1 ${choices.map(u => u.name).join(' or 1 ')}`,
        detail:'Any mix of these defenders, plus one escort.',
        defenderIds:faster.map(u => u.id),requiredIds:[],escortIds:choices.map(u => u.id),requiresHero:false});
    }
    if (hero.solo) {
      loads.push({key:'hero',speed:Infinity,label:'Hero only',detail:'No other troops.',defenderIds:[],requiredIds:[],escortIds:[],requiresHero:true});
      for (const speed of new Set(escorts.map(u => u.speed))) {
        const choices = escorts.filter(u => u.speed === speed);
        loads.push({key:`hero-escort-${speed}`,speed,label:`Hero + 1 ${choices.map(u => u.name).join(' or 1 ')}`,
          detail:'One escort; no defence pack.',defenderIds:[],requiredIds:[],escortIds:choices.map(u => u.id),requiresHero:true});
      }
    }
    return loads;
  }
  function compareOptions(a,b) {
    return Number(b.feasible)-Number(a.feasible)
      || (a.feasible ? a.sendAt-b.sendAt : b.sendAt-a.sendAt)
      || Number(a.withHero)-Number(b.withHero)
      || a.load.escortIds.length-b.load.escortIds.length
      || a.load.key.localeCompare(b.load.key);
  }
  function planContext(villages,settings) {
    integer(settings.attackMs,0,253402300799999,'Attack time');
    integer(settings.referenceMs,0,253402300799999,'Reference time');
    integer(settings.buffer,1,86400,'Safety margin (seconds)');
    if (settings.attackMs <= settings.referenceMs) throw new Error('The attack must land later than now. Check its UTC date and time.');
    distance(settings.target,settings.target);
    const cutoff = settings.attackMs-settings.buffer*1000;
    const target = villages.find(v => v.x === settings.target.x && v.y === settings.target.y) || null;
    return {cutoff,target};
  }
  function buildPlan(villages,profile,settings) {
    validateProfile(profile,villages);
    const {cutoff,target} = planContext(villages,settings);
    const enabled = profile.villages.filter(v => v.enabled);
    if (!enabled.length) throw new Error('Select at least one anvil village.');
    const groups = [], notices = [];
    for (const config of enabled) {
      const origin = villages.find(v => v.did === config.did);
      const fields = distance(origin,settings.target);
      if (!fields) {
        notices.push(`${origin.name} ${coordText(origin)} is already at the target.`);
        continue;
      }
      const loads = makeLoads(config,profile.hero);
      if (!loads.length) throw new Error(`Select available defenders for ${origin.name}, enable hero-only options, or unmark this anvil.`);
      const relation = relationship(origin,target);
      const grouped = new Map();
      for (const load of loads) for (const variant of heroVariants(origin,relation)) {
        if (load.requiresHero && !variant.withHero) continue;
        // Planner assumption: a mounted hero never slows a troop march.
        const speed = Number.isFinite(load.speed) ? load.speed : variant.speed;
        const seconds = travelSeconds(fields,speed,config.ts,variant.boots,variant.hand);
        const key = `${load.key}:${variant.withHero}:${seconds}`;
        if (grouped.has(key)) { grouped.get(key).equipment.push(variant); continue; }
        const sendAt = cutoff-seconds*1000, arrival = settings.referenceMs+seconds*1000;
        grouped.set(key,{load,withHero:variant.withHero,equipment:[variant],seconds,speed,sendAt,arrival,
          feasible:sendAt >= settings.referenceMs,earlySeconds:(settings.attackMs-arrival)/1000,origin,relation});
      }
      groups.push({origin,fields,ts:config.ts,relation,options:[...grouped.values()].sort(compareOptions)});
    }
    groups.sort((a,b) => compareOptions(a.options[0],b.options[0]) || a.origin.name.localeCompare(b.origin.name));
    return {kind:'players',settings,cutoff,target,groups,notices,playerId:profile.playerId};
  }
  function buildLeaderPlan(villages,roster,settings) {
    const {cutoff,target} = planContext(villages,settings);
    if (!roster.candidates.length) throw new Error('No CSV villages meet the troop thresholds.');
    const groups = [], notices = [];
    for (const candidate of roster.candidates) {
      const {origin,ts,tsPercentage,troops} = candidate;
      const fields = distance(origin,settings.target);
      if (!fields) { notices.push(`${origin.name} ${coordText(origin)} is already at the target.`); continue; }
      const relation = relationship(origin,target), options = [];
      for (const troop of troops) for (const variant of heroVariants(origin,relation)) {
        const seconds = travelSeconds(fields,troop.speed,ts,variant.boots,variant.hand);
        const sendAt = cutoff-seconds*1000;
        options.push({unitId:troop.id,count:troop.count,
          load:{key:`leader-${troop.id}`,label:troop.name,detail:'',escortIds:[]},
          withHero:variant.withHero,equipment:[variant],seconds,speed:troop.speed,sendAt,
          feasible:sendAt >= settings.referenceMs,origin,relation});
      }
      groups.push({origin,fields,ts,tsPercentage,options});
    }
    return {kind:'leaders',settings,cutoff,target,groups,notices};
  }
  function leaderChoices(group) {
    const choices = new Map();
    const itemCount = option => Number(option.equipment[0].boots > 0)+Number(option.equipment[0].hand > 1);
    for (const [index,option] of group.options.entries()) {
      const old = choices.get(option.unitId);
      if (!old || Number(option.withHero)-Number(old.option.withHero) < 0
        || (option.withHero === old.option.withHero && (itemCount(option) < itemCount(old.option)
          || (itemCount(option) === itemCount(old.option) && option.sendAt > old.option.sendAt)))) {
        choices.set(option.unitId,{option,index});
      }
    }
    return [...choices.values()];
  }
  const leaderTotal = group => leaderChoices(group).reduce((sum,choice) => sum+choice.option.count,0);
  const leaderScore = group => leaderChoices(group).reduce((sum,{option}) =>
    sum+option.count*(DEFENCE_SLOTS[group.origin.tribe].cavalry.includes(option.unitId) ? 2 : 1),0);
  function availablePlanGroups(plan,now) {
    const groups = plan.groups.map(group => ({...group,options:group.options.filter(option => option.sendAt >= now)}))
      .filter(group => group.options.length > 0);
    if (plan.kind === 'leaders') {
      const byPlayer = new Map();
      for (const group of groups) {
        const key = group.origin.uid ? `uid:${group.origin.uid}` : `name:${accountKey(group.origin.player)}`;
        if (!byPlayer.has(key)) byPlayer.set(key,{key,name:group.origin.player,score:0,total:0,groups:[]});
        const player = byPlayer.get(key), score = leaderScore(group), troopTotal = leaderTotal(group);
        player.score += score; player.total += troopTotal;
        player.groups.push({...group,score,troopTotal,playerKey:key});
      }
      return [...byPlayer.values()].sort((a,b) => b.score-a.score || b.total-a.total
        || a.name.localeCompare(b.name,undefined,{numeric:true}) || a.key.localeCompare(b.key))
        .flatMap(player => player.groups.sort((a,b) => b.score-a.score || b.troopTotal-a.troopTotal
          || a.origin.name.localeCompare(b.origin.name,undefined,{numeric:true}) || a.origin.did-b.origin.did)
          .map(group => ({...group,playerScore:player.score})));
    }
    return groups.sort((a,b) => compareOptions(a.options[0],b.options[0])
      || a.origin.player.localeCompare(b.origin.player) || a.origin.did-b.origin.did);
  }
  function validateSettings(settings) {
    if (!settings || typeof settings !== 'object') throw new Error('Invalid saved defence settings.');
    integer(settings.buffer,1,86400,'Safety margin (seconds)');
    return {buffer:settings.buffer};
  }
  function restoreSetup(value,villages = []) {
    if (!value || ![1,2,3,4,5,6,7].includes(value.version) || value.server !== SERVER || !value.profile) throw new Error('Not a supported TS12 defence setup.');
    if (!villages.length) throw new Error('The current map.sql is not loaded. Reload the hosted page, then import your settings.');
    const player = playersFromMap(villages).find(p => p.id === value.profile.playerId);
    if (!player) throw new Error('The saved account is not in L!, L# or L* in this map.');
    validateProfile(value.profile,villages);
    const profile = makeProfile(player);
    for (const config of value.profile.villages) {
      const index = profile.villages.findIndex(v => v.did === config.did);
      profile.villages[index] = {...emptyVillage(config),enabled:config.enabled,ts:config.ts,defenders:[...config.defenders],escorts:[...config.escorts]};
    }
    for (const key of Object.keys(profile.hero)) profile.hero[key] = value.profile.hero[key];
    return {profile,settings:validateSettings(value.version >= 7 ? value.settings : value.draft)};
  }
  globalThis.TravianDefence = Object.freeze({SERVER,ALLIANCES,TRIBES,parseMapSql,playersFromMap,parseCsvTable,parseTravcoCsv,makeLeaderRoster,parseCoordinates,createTargetIndex,searchTargets,resolveTarget,targetLabel,normalizeClockTime,parseUTC,formatUTC,formatClock,parseTravcoDefenceCalls,distance,travelSeconds,returnSeconds,makeProfile,validateProfile,relationship,heroVariants,makeLoads,buildPlan,buildLeaderPlan,leaderChoices,leaderTotal,leaderScore,availablePlanGroups,restoreSetup,MAP_LIMIT,integer,isoTime,formatDay,coordText,validateSettings});
})();
