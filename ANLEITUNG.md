# NAS Speed Dial – Einrichtung

Deine Gruppen und Links werden als Datei `speeddial.json` auf deiner Synology gespeichert.
Zusätzlich legt die Erweiterung jeden Tag eine Sicherung im Unterordner `backups` an.
Ist das NAS mal nicht erreichbar, funktioniert alles trotzdem – die Änderungen werden
nachgeholt, sobald die Verbindung wieder da ist (Punkt oben rechts: grün = synchron,
orange = nur lokal gespeichert).

---

## Teil 1 – Synology NAS vorbereiten (einmalig, ca. 10 Minuten)

1. **WebDAV Server installieren**
   DSM öffnen → *Paket-Zentrum* → nach **WebDAV Server** suchen → *Installieren*.

2. **WebDAV einschalten**
   Paket *WebDAV Server* öffnen → Haken bei **HTTP aktivieren** (Port **5005**).
   *Übernehmen*.

3. **Gemeinsamen Ordner anlegen**
   *Systemsteuerung* → *Gemeinsamer Ordner* → *Erstellen* → Name: **SpeedDial**.

4. **Eigenen Benutzer anlegen** (empfohlen – damit die Erweiterung nur an diesen einen Ordner kommt)
   *Systemsteuerung* → *Benutzer und Gruppe* → *Erstellen*
   - Name z. B. `speeddial`, ein Passwort vergeben
   - Ordnerberechtigungen: **SpeedDial = Lesen/Schreiben**, alles andere *Kein Zugriff*
   - Anwendungsberechtigungen: nur **WebDAV** erlauben
   - **Wichtig:** Beim Ordner SpeedDial unter *Bearbeiten → Erweiterte Berechtigungen* den
     Haken bei **„Erweiterte Freigabeberechtigungen aktivieren“ entfernen**. Sonst lehnt die
     Synology das Schreiben ab („Forbidden“ bzw. Fehler 405).

5. **IP-Adresse des NAS notieren**
   Steht in *Systemsteuerung* → *Netzwerk* → *Netzwerkschnittstelle* (z. B. `192.168.178.20`).
   Tipp: Im Router (z. B. FRITZ!Box) einstellen, dass das NAS immer dieselbe IP bekommt.

---

## Teil 2 – Erweiterung in Chrome installieren

1. Die ZIP-Datei **entpacken** (z. B. nach `Dokumente\NAS-Speed-Dial`). Den Ordner danach nicht löschen oder verschieben – Chrome lädt die Erweiterung von dort.
2. In Chrome `chrome://extensions` in die Adresszeile eingeben.
3. Oben rechts **Entwicklermodus** einschalten.
4. **Entpackte Erweiterung laden** → den entpackten Ordner auswählen.
5. FVD Speed Dial **deaktivieren** (sonst streiten sich beide um den neuen Tab).
6. Neuen Tab öffnen. Fragt Chrome „Wolltest du diese Seite ändern?“ → **Änderungen beibehalten**.

---

## Teil 3 – Erweiterung mit dem NAS verbinden

Im neuen Tab oben rechts auf **⚙** klicken:

| Feld | Eintrag |
|---|---|
| Adresse zu Hause | `http://192.168.178.20:5005` (deine NAS-IP) |
| Adresse unterwegs | siehe Teil 4, sonst leer lassen |
| Ordner auf dem NAS | `/SpeedDial` |
| Benutzername / Passwort | der Benutzer aus Teil 1, Schritt 4 |

**Verbindung testen** → sollte „verbunden ✓“ oder „erreichbar ✓“ zeigen → **Speichern**.

Chrome fragt einmal nach der Berechtigung, Daten auf Websites zu lesen. Die wird gebraucht,
um mit dem NAS zu sprechen und Vorschaubilder der Seiten aufzunehmen → **Zulassen**.

---

## Teil 4 – Von unterwegs nutzen

Am einfachsten und sichersten über ein **VPN** zu deinem Heimnetz. Dann gilt die
Heim-Adresse auch unterwegs, und am NAS muss nichts ins Internet freigegeben werden.
Möglich ist z. B. WireGuard über die FRITZ!Box (unten beschrieben) oder das Paket
**Tailscale** aus dem Synology-Paket-Zentrum.

Wer das NAS bereits anders erreichbar gemacht hat, trägt die zweite Adresse unter
**Adresse unterwegs** ein (z. B. `https://deinname.synology.me:5006`). Die Erweiterung
probiert immer zuerst die Heim-Adresse und nimmt sonst automatisch die zweite.
**Niemals** den HTTP-Port 5005 ins Internet freigeben – sonst wird das Passwort
unverschlüsselt übertragen.

### Beispiel: WireGuard der FRITZ!Box

Ist WireGuard auf dem Laptop/Handy eingeschaltet, ist das Gerät so im Heimnetz, als
wärst du zu Hause. Die **Adresse zu Hause** (`http://192.168.178.x:5005`) funktioniert dann
auch unterwegs – es muss nichts weiter eingerichtet werden.

1. **Adresse unterwegs** in den Einstellungen einfach **leer lassen**.
2. Unterwegs zuerst WireGuard verbinden, dann Chrome nutzen. Ohne VPN zeigt die
   Erweiterung „NAS offline“, speichert lokal und holt alles nach, sobald die
   Verbindung wieder steht.
3. Testen: Laptop mit dem Handy-Hotspot verbinden, WireGuard an → ⚙ →
   **Verbindung testen**.

**Wichtig:** Im WireGuard-Profil der FRITZ!Box muss eingestellt sein, dass das
**Heimnetz über den Tunnel** erreichbar ist (bei der Einrichtung in der FRITZ!Box unter
*Internet → Freigaben → VPN (WireGuard)* der Standard).

**Stolperfalle:** Hat das fremde Netz denselben Adressbereich wie dein Zuhause
(z. B. ebenfalls `192.168.178.x` bei einer anderen FRITZ!Box), kann der Laptop das NAS
nicht finden. Abhilfe: Im eigenen Heimnetz einen selteneren Bereich verwenden
(FRITZ!Box: *Heimnetz → Netzwerk → Netzwerkeinstellungen → IPv4-Einstellungen*,
z. B. `192.168.47.1`) – danach die neue NAS-Adresse in der Erweiterung eintragen.

**DNS-Rebind-Schutz** kann eingeschaltet bleiben: Weil die Erweiterung die IP-Adresse
benutzt, ist er nicht betroffen.

**Synology.me-Adresse:** wird hierfür nicht gebraucht. Bitte WebDAV (Port 5005/5006)
**nicht** im Router freigeben – mit WireGuard ist das unnötig und nur ein Risiko.

## Bedienung

Beim ersten Start sind schon fünf Beispielgruppen mit ein paar bekannten Seiten angelegt.
Sie sind nur zum Ausprobieren gedacht: umbenennen, ändern oder per Doppelklick auf den
Reiter → **Gruppe löschen** entfernen.

- **Gruppe wechseln:** auf den Reiter oben klicken
- **Neue Gruppe:** kleines **＋** neben den Reitern
- **Gruppe umbenennen/löschen:** Doppelklick oder Rechtsklick auf den Reiter
- **Seite hinzufügen:** die gestrichelte Kachel mit **＋**
  (lässt sich unter ⚙ → *Aussehen* → „＋-Kachel zum Hinzufügen anzeigen“ ausblenden –
  Seiten fügst du dann per Rechtsklick hinzu)
- **Per Rechtsklick hinzufügen:** auf einer Webseite (oder auf einem Link) Rechtsklick →
  **Zu Speed Dial hinzufügen** → Gruppe wählen. Am Erweiterungs-Symbol erscheint kurz ein ✓
  (ein „=“ heißt: die Seite ist in der Gruppe schon vorhanden).
- **Offene Tabs als Gruppe speichern:** alle gewünschten Seiten in Tabs öffnen, dann einen
  neuen Tab → kleines **＋** neben den Reitern → Namen eingeben → Haken bei
  **„Alle offenen Tabs dieses Fensters übernehmen“**. Bei einer bestehenden Gruppe geht das
  genauso über Doppelklick auf den Reiter.
- **Seite bearbeiten/löschen:** mit der Maus über die Kachel → ✎ oder ✕
- **Sortieren:** Kacheln und Reiter mit der Maus ziehen – ein weißer Strich zeigt, wo sie landen
  (linke Hälfte = davor, rechte Hälfte = dahinter)
- **In andere Gruppe verschieben:** Kachel auf einen Reiter ziehen
- **Vorschaubilder:** werden automatisch aufgenommen, wenn du eine Seite aus dem Speed Dial
  besuchst (alle 7 Tage neu). Oder im Bearbeiten-Dialog auf **📷 Vorschau aufnehmen**,
  bzw. in den Einstellungen **Alle fehlenden Vorschauen jetzt aufnehmen**.
- **Eigenes Bild:** im Bearbeiten-Dialog **🖼 Eigenes Bild…** – wird nie überschrieben.
- **Weiterer PC:** Erweiterung dort genauso installieren und dieselben NAS-Daten eintragen –
  die Gruppen erscheinen automatisch.

## PIN-Sperre (Sichtschutz)

- **Einschalten:** ⚙ → *PIN-Sperre* → Haken bei „Ganzen Speed Dial mit PIN schützen“,
  PIN (4–6 Ziffern) zweimal eingeben → Speichern.
- **Roter Knopf** oben rechts: sperrt sofort – auch in allen anderen offenen Tabs.
- **Automatisch sperren:** unter ⚙ → *PIN-Sperre* einstellbar (5 Min. bis 1 Std. ohne Benutzung).
  Sonst bleibt der Speed Dial entsperrt, bis du Chrome schließt.
- **PIN ändern oder entfernen:** an derselben Stelle; Feld leer lassen = alte PIN bleibt.
- **PIN vergessen?** Auf dem Sperrbildschirm „PIN vergessen?“ → Passwort des NAS-Benutzers
  eingeben → die PIN wird entfernt.
- Die PIN gilt auf allen PCs, die mit demselben NAS verbunden sind.
- **Gut zu wissen:** Die PIN ist ein Sichtschutz für den Speed Dial, keine Verschlüsselung.
  Bereits offene Tabs und Adressen, die man oben in Chrome eintippt, sperrt sie nicht.

## Gut zu wissen

- Benutzername und Passwort fürs NAS bleiben nur in diesem Chrome gespeichert, sie
  landen nicht in der Datei auf dem NAS.
- Sicherungen liegen auf dem NAS unter `SpeedDial/backups/` (klappt das Anlegen des Unterordners nicht, direkt in `SpeedDial` als `speeddial-backup-DATUM.json`). Zurückholen: in den
  Einstellungen **Datei importieren**.
