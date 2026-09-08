# Shortplanner — användarmanual

[English](manual.md) · **Svenska**

En genomgång av varje flik och kontroll. För vad Shortplanner är, hur man installerar det och API:t, se [README](../README.sv.md).

---

## Kom igång

**Projekt** är utgångsläget. Skapa ett tomt projekt, eller duplicera/importera ett befintligt. **Projektinfo** (i topplisten inne i ett projekt) håller grunduppgifter — titel, bolag, producent, regi, foto, 1:e AD, platschef, inspelningsdatum, format — som förifyller nya call sheets när de skapas. Här ligger också arbetstidsreglerna stripboardet stämmer av varje dag mot (max arbetstid/dag, lunch senast efter samling, minsta dygnsvila mellan inspelningsdagar — i timmar; tomt = standard 10 / 5 / 11), och vilka **flikar** projektet visar: stäng av Rullplan, DPR eller Inspelningsläge för projekt som inte använder dem.

**⚙ Inställningar** (på projektlistan) gäller hela installationen: företagsnamn/logga för call sheets och gränssnittsspråk. Vilka flikar ett projekt visar ställs in per projekt, i **Projektinfo**.

## Stripboard-fliken

- Dra i handtaget (⋮⋮) för att flytta en strip — inom en dag, mellan dagar, eller till och från banken *Ej schemalagt* längst ner. Funkar med mus eller finger. **⋯**-menyn på en strip flyttar den till en viss dag (eller till *Ej schemalagt*) utan att dra.
- Sidor, est. tid, I/E och DAG/NATT är dropdowns. I/E och DAG/NATT styr stripens färg.
- På en strip som inte är en scen: klicka **i**-cirkeln för att välja typ uttryckligen — Info, förflyttning eller rast/lunch — i stället för att låta texten avgöra. "Auto" går tillbaka till att avgöra på texten.
- Ändrar du est. tid räknas efterföljande starttider om automatiskt.
- 🔒 låser en starttid så den inte flyttas vid omräkning. Skriver du in en tid manuellt låses den automatiskt — så behåller du medvetna luckor i dagen.
- Dagar över 12 timmar flaggas gult i dagfoten. Utöver det visar dagfoten en varningsrad när en dag bryter mot en arbetstidsregel från **Projektinfo**: arbetstid (dagens spann minus rast/lunch-strips) över gränsen, ingen rast/lunch inplanerad eller lunch för långt efter samling, eller mindre än minsta dygnsvila mellan föregående inspelningsdags slut och den här dagens samling. En röd varning gör dessutom dagens spann-siffra röd.
- **Duplicera dag** i dagfoten kopierar en hel inspelningsdag (alla strips, datumet tomt) som en ny dag.
- **📥 Importera scener** skapar en strip per scen i ett importerat manus (i "Ej schemalagt", manusordning), eller läser in en hel stripboard-fil (JSON, från en annan Shortplanner-installation eller ett eget tidigare exporterat projekt).

**Skapa call sheet →** i en dagfot bygger en call sheet av den dagen: schema med info-rader och totalrad, kallningstider (30 min före dagstart, mask 60 min före), arbetstid och rollista från scenernas roll-ID:n. Finns redan en call sheet för dagen står det **Uppdatera call sheet →** — kör den igen så uppdateras schemat medan platser, kontakter, väder och skådespelartider du fyllt i behålls. Call sheets-fliken visar en banner om att planen är inaktuell ifall stripboarddagen ändrats efter att call sheeten senast genererades.

Skriv `MOS` i en scens set/rubrik-fält för att markera att den spelas in utan ljud — vedertagen branschterm ("Mit Out Sound"), ingen särskild funktion i appen men bra att känna till.

## Manus-fliken

Importera ett manus som PDF (numrerad tagningsmanus-konvention, scennummer i båda marginalerna) eller Fountain. Varje scen visar sin status mot den faktiska planen: schemalagd (med dag och tid), boneyard, eller saknas i planen. **↳ Skapa stripboard av scenerna** bygger strips av hela manuset på en gång om du hellre planerar utifrån manuset än tvärtom.

## Dagsmanus-fliken

Genererar tryckfärdiga sidor per inspelningsdag direkt ur manus + stripboardets ordning — ingen sparad kopia, ändrar du schemat speglas det direkt.

## Rullplan-fliken

Budgeterar fysisk film: skärmtid per scen (föreslås proportionellt mot manussidorna, override:as manuellt), skjutförhållande (redigerbart, standard 14:1), rullar (11 min/rulle). Slå på Redigera för att skriva in vad som faktiskt rullades per scen och markera en dag som wrappad — budget-burn-blocket visar då budget/förbrukat/kvar.

## DPR-fliken

Daglig produktionsrapport, internt — inte med i delade länkar. Genereras från en dags call sheet: bocka av scener som klara/delvis/flyttade/strukna, sidor tagna, faktiska tider mot planerade.

## Inspelningsläge

En 🎬-knapp ligger i fliksraden, bredvid DPR. Den öppnar ett helskärmsläge byggt för 1:e AD:ns telefon på inspelningsplatsen: en "starta dagen"-skärm, sedan ett steg i taget — scener, plus rast/lunch- och förflyttningsraderna från call sheeten — med general call, planerad start, stämplad faktisk start och en rullande beräknad wrap som kryper med klockan (grön/gul/röd mot planerad wrap). Stora knappar: **✓ Klar** (stämplar faktiskt slut och går vidare), **◐ Delvis**, **→ Hoppa över** (flyttar bara pekaren, lämnar steget omarkerat), **◂ Backa**, **+10 / +20 min** (lägger slip på aktuellt steg). Tryck på en rad i steglistan för att göra den till den aktuella ur ordning; tryck på ✎ på faktisk-start-raden för att korrigera en stämplad tid. Allt skrivs rakt in i DPR-dagen — lunch ut/in, första tagning och camp wrap fyller i sig själva. Kräver nät (autospar som vanligt). När det inte är en inspelningsdag (ingen DPR-dag inom ett dygn från idag) öppnas läget med ett meddelande om det i stället för stepparen.

## Skådespelare

Knappen **Skådespelare** i topplisten öppnar ett litet register: ID, roll/karaktär och (valfritt) skådespelarens namn. Lägg till och ta bort fritt, redigera roll/namn genom att klicka i fälten. ID:t är det du skriver i stripboardets Roller-kolumn.

I både stripboardets Roller-kolumn och call sheetens schema är cast-fältet en knapp — klicka för att öppna en kryssruteslista över registret och välj en eller flera. Panelen stängs och sparar när du klickar utanför eller på **Klar**.

## Call sheets

**Call sheets-fliken** har en redigeringsknapp uppe till höger. Slå på den för att ändra fält och lägga till rader (inklusive "+ Lägg till skådespelare"); slå av den för att läsa och skriva ut. Platser och OBS-noteringar går att dra om i ordning i redigeringsläge — ta tag i handtaget (⋮⋮) till vänster om posten och släpp där du vill ha den; OBS-noteringar visas i två kolumner. Avdelningsrutor under Kallningstider går att ta bort med krysset i hörnet.

**Väder.** I call sheetens väderrad hämtar **🔄 Hämta väder** en prognos från SMHI (fallback MET Norway/Yr.no) plus gryning/solnedgång, för kl 12:00 lokal tid (Stockholm, sommar-/vintertid hanteras) den dag call sheeten gäller — baserat på adressen till första platsen i PLATSER-listan, eller sjukhusets om ingen plats har en riktig adress ännu. Fungerar bara för datum inom den närmaste veckan eller så — längre fram finns ingen prognos ännu.

**Kallningstider skådespelare.** Tabellen längst ner i call sheeten fylls i manuellt via **+ Lägg till skådespelare** (välj från registret eller skriv fritext), eller automatiskt via **🔄 Uppdatera från schema** — då räknas Call/Mask-Kostym/On set/Wrap fram per person utifrån deras faktiska första och sista scen den dagen (inte dagens allmänna starttid). Manuellt tillagda som inte förekommer i något scenschema rörs inte.

**Platser.** Varje plats i PLATSER-blocket — och Akut/Sjukhus-rutan bredvid — kan få koordinater, parkering, toalett, övriga faciliteter och en säkerhetsnotering, alla tomma tills du fyller i dem i redigeringsläge. Koordinatfältet tar tre sorters inmatning: skriv in `65.67120, 21.98430` direkt (komma eller punkt som decimaltecken går båda bra), klistra in en hel Google Maps-länk (koordinaterna plockas ur `@lat,lng`, `?q=`, `?query=` eller den inbäddade `!3d!4d`-datan — en kort `maps.app.goo.gl`-länk utan synliga koordinater följs och löses upp server-sidan), eller klicka **📍 Från adress** för att slå upp koordinater automatiskt från adressfältet (Nominatim/OpenStreetMap). Koordinaterna är sanningen: så fort en plats har dem visas en klickbar "📍 Karta"-länk på skärmen, och vid utskrift ersätts länken av en QR-kod till samma Google Maps-position — genererad som inline-SVG i webbläsaren, ingen tredjepartstjänst inblandad. START/SLUT (dagens utgångspunkt/övernattning) ärvs mellan dagar och visar bara en kartnål på mobil tills du fäller ner adressen. Väntar du dålig mobiltäckning på en inspelningsplats, lägg till en **offline-varning** för den dagen — den påminner om att ladda ner offlinekartor i förväg, eftersom QR-koderna kräver nät för att slå upp adressen skannad.

> Kontrollera alltid QR-koderna innan en plan går ut till teamet: skriv ut till PDF (eller på riktigt) och skanna varje kod, inte bara ett stickprov.

## Dela

Knappen **Dela** i topplisten genererar en skrivskyddad länk (`/share/<token>`) — ingen inloggning krävs för att se den, alla redigeringskontroller är borttagna. Fem kryssrutor väljer vad länken visar: Stripboard, Call sheet, Manus, Dagsmanus, Rullplan. Alla är på från början; kryssar du ur en slår det igenom på samma länk direkt (token ändras inte). Manustexten skickas bara när Manus eller Dagsmanus delas — med bara Rullplan ikryssad får länken scennummer, sluglines och sid-/skärmtidssiffror men ingen manusbrödtext. DPR (internt) är aldrig med. **Ta bort delning** ogiltigförklarar länken direkt.

## Versioner

Allt sparas löpande — indikatorn uppe i topplisten visar *Sparat HH:MM*. När du vill frysa ett läge klickar du **Spara version** och namnger det. Vid **Återställ** sparas nuvarande läge automatiskt som *Före återställning* först, så du kan aldrig måla in dig i ett hörn. Redigerar samma projekt på två enheter samtidigt varnar appen och låter dig välja vilken version som gäller, istället för att tyst skriva över.

## Sidtitel och utskrift

Webbläsarfliken (och därmed det föreslagna filnamnet när man skriver ut till PDF) speglar vad man tittar på — "Projektnamn – Stripboard", eller "Projektnamn – Call sheet – Måndag - Dag 1" och så vidare när man byter dag. Gäller både den inloggade appen och den publika delningslänken. Call sheets, dagsmanus (A5) och stripboardet har var sitt eget utskriftsstilark.

## Offline

Shortplanner går att installera som en app (PWA) från webbläsaren. Senast hämtade call sheet, stripboard och dagsmanus går att läsa utan nätverk — praktiskt på inspelningsplatser utan täckning. Att redigera kräver fortfarande nät.
