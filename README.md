# Dirdal Unge Mannsforening – bibelgruppe

Nettsida til bibelgruppa: neste samling, kva vi les, oversikt over alle bøkene i Bibelen med det vi har lese merka av, kven vi har vore hos, eit forum, og medlemsliste med adresser som opnar i Google Maps.
Alle loggar inn med **fornamn og eit felles passord**. Første gong eit namn loggar inn, blir brukaren oppretta. Det felles passordet er det same som gruppekoden i databasen (`private.settings.invite_code`), så berre dei som kan passordet kjem inn. Dei som laga brukar med e-post før, kan framleis logge inn under «Med e-post».

Sida er reine filer (HTML/CSS/JS) som ligg gratis på GitHub Pages. Data og innlogging ligg i Supabase (gratisplan).

## Prøv lokalt

Opne `index.html` gjennom ein liten webserver, til dømes:

```
python -m http.server 8000
```

og gå til http://localhost:8000. Så lenge `config.js` er tom, køyrer sida i **demomodus** med eksempeldata i nettlesaren.

## Oppsett (ein gong, ca. 15 minutt)

### 1. Supabase (database og innlogging)
1. Opprett ein gratis konto på https://supabase.com og lag eit nytt prosjekt (region: Stockholm eller Frankfurt).
2. Opne **SQL Editor**, lim inn heile `schema.sql`, byt ut `'byt-meg'` med gruppekoden de vil bruke, og trykk **Run**. Køyr deretter `oppdatering-2.sql` (lesing utan samling, wiki, «Anna info», medlemstekst) og `oppdatering-3.sql` (påmelding, samtale/forslag om ny dag, kalender) på same måte.
   - Kalenderabonnement: **Edge Functions → Deploy a new function → Via Editor**, kall funksjonen `kalender`, lim inn `supabase/functions/kalender/index.ts` og trykk Deploy. Opne funksjonen etterpå, gå til **Details** og slå av **Verify JWT**, og lagre.
3. Legg inn medlemslista: køyr den private fila `medlemmar.sql` (ligg utanfor repoet, i `dirdal-umf-privat`) i SQL Editor på same måte. Adresser og telefonnummer skal **aldri** ligge i dette repoet, sidan det er offentleg; i databasen er dei berre synlege for innlogga medlemer.
4. Gå til **Project Settings → API** og kopier *Project URL* og *anon public*-nøkkelen inn i `config.js`.
5. Gå til **Authentication → URL Configuration**:
   - *Site URL*: adressa til sida, t.d. `https://BRUKARNAMN.github.io/dirdal-umf/`
   - Legg same adresse til under *Redirect URLs*.
6. (Valfritt) Under **Authentication → Providers → Email** kan du slå av «Confirm email» om de ikkje vil stadfeste e-posten.

Anon-nøkkelen er laga for å liggje offentleg i nettsida. Tilgangen er styrt av reglane i `schema.sql`: berre innlogga medlemer kan lese og skrive, og kvar person kan berre slette sine eigne foruminnlegg.

### 2. GitHub Pages (nettsida)
1. Lag eit nytt repo på GitHub, t.d. `dirdal-umf`, og push denne mappa dit.
2. I repoet: **Settings → Pages → Build and deployment → Deploy from a branch**, vel `main` og `/ (root)`.
3. Etter eitt minutt eller to ligg sida på `https://BRUKARNAMN.github.io/dirdal-umf/`.

### Byte det felles passordet / gruppekoden
Køyr dette i SQL Editor:

```sql
update private.settings set invite_code = 'ny-kode' where id = 1;
```

Merk: dette gjeld nye brukarar. Brukarar som alt er oppretta, loggar framleis inn med passordet dei hadde då dei vart oppretta.

## Filer
| Fil | Innhald |
| --- | --- |
| `index.html` | Sida |
| `styles.css` | Utsjånad (lyst og mørkt tema) |
| `app.js` | All logikk: innlogging, samlingar, lesekart, forum |
| `bible.js` | Bøkene i Bibelen med nynorske namn og tal på kapittel |
| `config.js` | Supabase-adresse og offentleg nøkkel |
| `schema.sql` | Tabellar, tilgangsreglar og gruppekode |
