# 🤖 Bot Discord de recrutement

Bot de candidatures avec tickets privés, 5 questions, et boutons **Accepter / Refuser / Fermer**.

## 1. Créer le bot sur Discord

1. Va sur https://discord.com/developers/applications → **New Application**.
2. Onglet **Bot** → **Reset Token** → copie le token (c'est ton `TOKEN`).
3. Dans **Bot > Privileged Gateway Intents**, active **MESSAGE CONTENT INTENT** (obligatoire pour lire les réponses).
4. Onglet **General Information** → copie l'**Application ID** (c'est ton `CLIENT_ID`).
5. Onglet **OAuth2 > URL Generator** :
   - Scopes : `bot` + `applications.commands`
   - Permissions : `Manage Channels`, `Manage Roles`, `View Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`
   - Ouvre l'URL générée et invite le bot sur ton serveur.

## 2. Configurer

```bash
npm install
cp .env.example .env
```

Remplis `.env` (active le mode développeur dans Discord > Paramètres > Avancés pour copier les ID via clic droit) :

| Variable | Description |
|---|---|
| `TOKEN` | Token du bot |
| `CLIENT_ID` | ID de l'application |
| `GUILD_ID` | ID du serveur |
| `STAFF_ROLE_ID` | Rôle qui gère les candidatures |
| `CATEGORY_ID` | Catégorie où créer les tickets (optionnel) |
| `LOG_CHANNEL_ID` | Salon de logs + transcripts (optionnel) |
| `ACCEPTED_ROLE_ID` | Rôle donné aux candidats acceptés (optionnel) |

Modifie les **5 questions** et les textes du panneau dans `config.json`.

> ⚠️ Si tu veux donner un rôle aux acceptés, le rôle du bot doit être **placé au-dessus** de ce rôle dans la liste des rôles du serveur.

## 3. Lancer

```bash
npm start
```

Puis, dans le salon de ton choix, tape **`/panel-recrutement`** (réservé aux administrateurs).

## 4. Héberger 24h/24

Il te faut Node.js 18.17+ sur un serveur/VPS ou un hébergeur de bots. Avec **PM2** :

```bash
npm install -g pm2
pm2 start index.js --name recrutement-bot
pm2 save
pm2 startup
```

## Fonctionnement

- Un clic sur **Postuler** crée un salon privé `candidature-pseudo` (visible par le candidat et le staff).
- Le bot pose les questions une par une (timeout de 10 min par question, réglable dans `config.json`).
- Le récapitulatif est posté avec les boutons staff.
- **Accepter** : MP au candidat + rôle automatique (si configuré) + log.
- **Refuser** : fenêtre pour saisir un motif, MP au candidat + log.
- **Fermer** : transcript `.txt` envoyé dans le salon de logs, puis suppression du salon.

## Limites connues

- Si le bot redémarre pendant que quelqu'un répond aux questions, ce ticket-là doit être fermé et refait. Les tickets déjà arrivés au récapitulatif, eux, continuent de fonctionner après un redémarrage.
- Un candidat ne peut avoir qu'un ticket ouvert à la fois.
