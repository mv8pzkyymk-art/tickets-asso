# Tickets Asso : scanner les tickets AECA / ACAPEL vers pCloud

Web app installable sur téléphone (Android et iPhone), sans passer par un store.

## Ce que fait l'appli

1. Une bascule en haut choisit l'association : **AECA** (bleu) ou **ACAPEL** (vert). La couleur de tout l'écran change, pour éviter les erreurs.
2. Le gros bouton **Scanner un ticket** ouvre l'appareil photo.
3. On saisit le commerce et le montant (la date du jour est préremplie, le commerce est proposé à partir des précédents).
4. Le nom du fichier est construit automatiquement et affiché avant l'envoi, par exemple
   `20261014-Leclerc Drive-42,50-ACAPEL.jpg`.
5. **Envoyer vers pCloud** dépose la photo (compressée en JPEG) dans le dossier de l'association :
   `/Carlo Acutis/GS Carlo Acutis - CA/Groupe Scolaire/GSCA/05. Comptabilité - Finances/03. Factures - Comptabilité/ticket reconnu IA/AECA/` (ou `/ACAPEL/`).
   Les dossiers existants sont réutilisés, les manquants sont créés.
6. Sans réseau, le ticket reste en attente sur le téléphone et part tout seul au retour de la connexion.

## Réglages (roue dentée)

- **Connexion pCloud** : e-mail et mot de passe du compte pCloud, saisis une fois. Le mot de passe n'est pas gardé,
  seul un jeton d'accès reste sur le téléphone. Les serveurs Europe et USA sont détectés automatiquement.
- **Dossiers de destination** pour chaque association, et rangement par mois (désactivé par défaut).
- **Règle de nommage** : modèle avec les variables `{date} (AAAAMMJJ) {date_iso} (AAAA-MM-JJ) {annee} {mois} {jour} {asso} {commerce} {montant} {carte}`.
  Par défaut, la règle des associations : `{date}-{commerce}-{montant}-{asso}`.
- **Cartes bancaires** : si vous listez les cartes d'une association, un choix « Carte utilisée » apparaît
  et peut entrer dans le nom via `{carte}`.

Conseil : créez un compte pCloud dédié (ou un dossier partagé) plutôt que d'utiliser votre compte personnel
sur le téléphone du directeur.

## Mettre l'appli en ligne

L'appli est un simple dossier de fichiers. Il faut l'héberger en HTTPS (gratuit) :

- **Le plus simple : Netlify Drop.** Aller sur https://app.netlify.com/drop, glisser le dossier `tickets-app`
  (ou le fichier `tickets-app.zip` décompressé). Une adresse du type `https://xxxx.netlify.app` est donnée.
- **Ou GitHub Pages** : déposer ces fichiers dans un dépôt GitHub et activer Pages.

## Installer sur le téléphone

- **iPhone (Safari)** : ouvrir l'adresse, bouton Partager, « Sur l'écran d'accueil ».
- **Android (Chrome)** : ouvrir l'adresse, menu ⋮, « Installer l'application » ou « Ajouter à l'écran d'accueil ».

L'icône « Tickets Asso » apparaît ensuite comme une appli normale. Faire les réglages une fois sur chaque téléphone.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | écrans de l'appli |
| `app.js` | photo, nommage, file d'attente, envoi pCloud |
| `style.css` | apparence |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | installation sur téléphone et fonctionnement hors ligne |
