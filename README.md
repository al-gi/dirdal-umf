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
   - Fornamnsinnlogging for dei med e-postbrukar: lag funksjonen `namn-login` på same måte frå `supabase/functions/namn-login/index.ts`, og slå av **Verify JWT**.
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

## Varsel (ikkje slått på enno)

Kvar innlogga brukar kan velje push-varsel på sin eigen telefon. Vala ligg på `auth.uid()`. Felles passord betyr at den som kan namnet og passordet, kan logge inn som den brukaren og endre varsla der. Ingen kan lese andre sine abonnement gjennom API-et.

Kategoriar: dagen før neste samling, ny wikiside, nytt innlegg eller svar i forumet, og oppdatering på sida (namn, tid, om-tekst, beskjed). Låseskjermen får berre ein kort fast tekst, aldri innlegg, notat eller adresse. Avsendaren får ikkje varsel om sitt eige innlegg.

Påminning blir lagd i køen **kl. 18 Europe/Oslo dagen før** samlinga. Viss køyringa kl. 18 ikkje går, blir det prøvd igjen kl. 19. Klokkeslettet blir rekna i tidssona `Europe/Oslo`, så sommar- og vintertid ikkje er eit fast UTC-tidspunkt. Avlyst eller utsett samling får ikkje påminning. Vert datoen endra, gjeld den nye dagen. Ei avlysing etterpå gir eit eige kort varsel.

Koden og migrasjonen ligg i repoet. Dei er **ikkje køyrde** mot produksjonsdatabasen, og ingen varsel er sende til medlemer. For å slå det på seinare, utan nye betalte tenester:

1. Køyr `oppdatering-8.sql` i Supabase → SQL Editor.
2. Lag VAPID-nøklar lokalt, ikkje legg dei i git: `npx --yes web-push generate-vapid-keys`.
3. Legg hemmelegheitene på edge-funksjonen `varsel` (Project Settings → Edge Functions → Secrets): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, og `VAPID_SUBJECT`. Subject kan vere `mailto:ei-adresse-de-eig` eller ein `https:`-URL, til dømes `https://al-gi.github.io/dirdal-umf/`. `SUPABASE_SERVICE_ROLE_KEY` blir sett av Supabase og skal ikkje inn i nettlesaren.
4. Deploy `supabase/functions/varsel` med **Verify JWT på**. Det må bli ståande på: porten sjekkar signaturen, og funksjonen les berre at JWT-et har `role=service_role`. Då verkar både det gamle service_role-JWT-et frå `pg_cron` og ein `sb_secret_`-nøkkel i `SUPABASE_SERVICE_ROLE_KEY` eller `SUPABASE_SECRET_KEYS`. anon og innlogga brukarar kan ikkje tømme køen. Dei kan berre hente den offentlege nøkkelen.
5. Legg ein timeplan på funksjonen, `* * * * *` (kvart minutt), så køen blir tømd. Påminninga skjer likevel berre i vindauget kl. 18–19 Oslo. Supabase kallar funksjonen med service role.

På iPhone verkar varsel berre i den installerte appen (heimskjermen), frå iOS 16.4. Sida spør om løyve først når brukaren trykker «Slå på varsel».

Test logikken utan å sende noko: `node --test supabase/functions/varsel/logic.test.mjs`.

## Filer
| Fil | Innhald |
| --- | --- |
| `index.html` | Sida |
| `styles.css` | Utsjånad (lyst og mørkt tema) |
| `app.js` | All logikk: innlogging, samlingar, lesekart, forum |
| `bible.js` | Bøkene i Bibelen med nynorske namn og tal på kapittel |
| `places.js` | Stader i Bibelen med koordinatar per kapittel (OpenBible.info, CC BY 4.0) til kartet på neste samling |
| `config.js` | Supabase-adresse og offentleg nøkkel |
| `push.js` | Varselval i profilen. Løyve berre etter trykk |
| `sw.js` | Mellomlager for skallet, og vising av push |
| `supabase/functions/varsel` | Utsending og påminning. Ikkje deploya enno |
| `oppdatering-8.sql` | Tabellar for varsel. Ikkje køyrd i produksjon enno |
| `schema.sql` | Tabellar, tilgangsreglar og gruppekode |
