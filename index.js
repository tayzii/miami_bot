require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    SlashCommandBuilder,
    MessageFlags,
    Events
} = require('discord.js');

// ============================================================
//  CONFIGURATION  (tout ce que tu peux modifier est ici)
// ============================================================

const CONFIG = {
    couleur: '#D4AF37',
    couleurOk: '#2ECC71',
    couleurNon: '#E74C3C',
    categorieNom: '📂 CANDIDATURES',
    tempsParQuestionMs: 5 * 60 * 1000, // 5 minutes par question
    footer: 'Miami Boyz • Recrutement',
    panneau: {
        titre: '🌴 MIAMI BOYZ | RECRUTEMENT',
        bouton: 'POSTULER',
        description:
            '**Les recrutements sont ouverts !**\n\n' +
            'Tu souhaites rejoindre les Miami Boyz ?\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━\n' +
            '📋 Clique sur **POSTULER** pour ouvrir ton ticket.\n' +
            '📝 Tu devras répondre à **5 questions**.\n' +
            '🎙️ Les leads pourront ensuite te contacter pour un **entretien vocal**.\n' +
            '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '**Bonne chance à tous !**'
    }
};

const QUESTIONS = [
    { champ: '⏱️ Heures sur FiveM', question: 'Combien d’heures as-tu sur FiveM ?', inline: true },
    { champ: '🎂 Âge (IRL)', question: 'Quel est ton âge (IRL) ?', inline: true },
    { champ: '🧭 Expérience RP', question: 'Quelle est ton expérience RP ? (serveurs, groupes illégaux précédents...)', inline: false },
    { champ: '⭐ Qualités en RP', question: 'Quelles sont tes qualités en RP ?', inline: false },
    { champ: '⚠️ Défauts', question: 'Quels sont tes défauts ?', inline: false }
];

// ============================================================
//  VARIABLES D'ENVIRONNEMENT
// ============================================================

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
// Rôle des leads / staff (LEAD_ROLE_ID ou STAFF_ROLE_ID, au choix) - optionnel
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || process.env.LEAD_ROLE_ID || '';
// Catégorie des tickets - optionnel (sinon créée automatiquement)
const CATEGORY_ID = process.env.CATEGORY_ID || '';
// Salon de logs + transcripts - optionnel
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '';
// Rôles donnés aux acceptés, séparés par une virgule - optionnel
const ACCEPTED_ROLE_IDS = (process.env.ACCEPTED_ROLE_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
// Bannière du panneau (lien d'image) - optionnel
const BANNER_URL = process.env.BANNER_URL || '';

if (!TOKEN || !GUILD_ID) {
    console.error('❌ TOKEN et GUILD_ID sont obligatoires (variables Railway ou fichier .env).');
    process.exit(1);
}

const EPHEMERAL = MessageFlags?.Ephemeral ?? 64;
const TOPIC_PREFIX = 'candidat:';
const VOTE_FIELD = '🗳️ Votes du staff';
const STATUS_FIELD = '📌 Statut';
const STATUS_PENDING = '⏳ En attente de décision';

// ============================================================
//  CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const creationEnCours = new Set();

// ============================================================
//  OUTILS
// ============================================================

function estStaff(interaction) {
    if (!interaction.inGuild()) return false;

    const perms = interaction.memberPermissions;
    if (
        perms?.has(PermissionFlagsBits.Administrator) ||
        perms?.has(PermissionFlagsBits.ManageChannels)
    ) {
        return true;
    }

    return Boolean(STAFF_ROLE_ID && interaction.member?.roles?.cache?.has(STAFF_ROLE_ID));
}

async function repondre(interaction, content) {
    const payload = { content, flags: EPHEMERAL };
    if (interaction.deferred || interaction.replied) {
        return interaction.followUp(payload).catch(() => {});
    }
    return interaction.reply(payload).catch(() => {});
}

function candidatIdDuTicket(channel) {
    return channel?.topic && channel.topic.startsWith(TOPIC_PREFIX)
        ? channel.topic.slice(TOPIC_PREFIX.length)
        : null;
}

function ticketExistant(guild, userId) {
    return guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && c.topic === `${TOPIC_PREFIX}${userId}`
    );
}

function couper(texte, max = 900) {
    return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte;
}

async function envoyerLog(guild, payload) {
    if (!LOG_CHANNEL_ID) return;
    const salon = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (salon) await salon.send(payload).catch(() => {});
}

function remplacerChamp(embed, nom, valeur) {
    const champs = (embed.data.fields || []).map(f => ({ ...f }));
    const index = champs.findIndex(f => f.name === nom);
    if (index >= 0) champs[index].value = valeur;
    else champs.push({ name: nom, value: valeur });
    return embed.setFields(champs);
}

// ----- Votes -----

function lireVotes(embed) {
    const votes = { pour: [], contre: [] };
    const champ = embed?.fields?.find(f => f.name === VOTE_FIELD);
    if (!champ) return votes;

    for (const ligne of champ.value.split('\n')) {
        const ids = [...ligne.matchAll(/<@(\d+)>/g)].map(m => m[1]);
        if (ligne.startsWith('👍')) votes.pour = ids;
        else if (ligne.startsWith('👎')) votes.contre = ids;
    }
    return votes;
}

function formaterVotes(votes) {
    const liste = tab => (tab.length ? tab.map(id => `<@${id}>`).join(' ') : '—');
    return (
        `👍 **Pour (${votes.pour.length})** : ${liste(votes.pour)}\n` +
        `👎 **Contre (${votes.contre.length})** : ${liste(votes.contre)}`
    );
}

// ----- Boutons -----

function boutonsDecision(votes) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('mbz_vote_pour')
                .setLabel(`Pour (${votes.pour.length})`)
                .setEmoji('👍')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('mbz_vote_contre')
                .setLabel(`Contre (${votes.contre.length})`)
                .setEmoji('👎')
                .setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('mbz_accepter')
                .setLabel('Accepter')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('mbz_refuser')
                .setLabel('Refuser')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('mbz_fermer')
                .setLabel('Fermer le ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Secondary)
        )
    ];
}

function boutonFermerSeul() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mbz_fermer')
            .setLabel('Fermer le ticket')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Secondary)
    );
}

// ----- Catégorie & ticket -----

async function obtenirCategorie(guild) {
    if (CATEGORY_ID) {
        const cat =
            guild.channels.cache.get(CATEGORY_ID) ||
            (await guild.channels.fetch(CATEGORY_ID).catch(() => null));
        if (cat && cat.type === ChannelType.GuildCategory) return cat;
    }

    let categorie = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name === CONFIG.categorieNom
    );

    if (!categorie) {
        categorie = await guild.channels.create({
            name: CONFIG.categorieNom,
            type: ChannelType.GuildCategory
        });
    }

    return categorie;
}

async function creerTicket(guild, user) {
    const categorie = await obtenirCategorie(guild);

    const permissions = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
            ]
        },
        {
            id: client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ManageChannels
            ]
        }
    ];

    if (STAFF_ROLE_ID) {
        permissions.push({
            id: STAFF_ROLE_ID,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    const nom = `candidature-${user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 85);

    return guild.channels.create({
        name: nom || `candidature-${user.id}`,
        type: ChannelType.GuildText,
        parent: categorie.id,
        topic: `${TOPIC_PREFIX}${user.id}`,
        permissionOverwrites: permissions
    });
}

// ============================================================
//  PANNEAU
// ============================================================

async function envoyerPanneau(channel) {
    const embed = new EmbedBuilder()
        .setColor(CONFIG.couleur)
        .setTitle(CONFIG.panneau.titre)
        .setDescription(CONFIG.panneau.description)
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: 'MBZ Recrutement' })
        .setTimestamp();

    if (BANNER_URL) embed.setImage(BANNER_URL);

    const boutons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mbz_postuler')
            .setLabel(CONFIG.panneau.bouton)
            .setEmoji('📋')
            .setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [embed], components: [boutons] });
}

// ============================================================
//  QUESTIONNAIRE
// ============================================================

function barreProgression(etape, total) {
    return '▰'.repeat(etape) + '▱'.repeat(total - etape);
}

async function poserQuestions(ticket, user) {
    const total = QUESTIONS.length;
    const reponses = [];

    const intro = new EmbedBuilder()
        .setColor(CONFIG.couleur)
        .setTitle('🎫 CANDIDATURE MIAMI BOYZ')
        .setDescription(
            `Bienvenue ${user} 👋\n\n` +
            `Tu vas répondre à **${total} questions**, directement dans ce salon.\n\n` +
            `⏱️ **5 minutes** par question\n` +
            `✏️ Écris **annuler** pour abandonner\n` +
            `💡 Sois honnête et précis, ça aide les leads à te connaître.`
        )
        .setFooter({ text: CONFIG.footer });

    await ticket.send({
        content: `${user}`,
        embeds: [intro],
        allowedMentions: { users: [user.id] }
    });

    for (let i = 0; i < total; i++) {
        const embed = new EmbedBuilder()
            .setColor(CONFIG.couleur)
            .setTitle(`QUESTION ${i + 1}/${total}`)
            .setDescription(`**${QUESTIONS[i].question}**\n\n\`${barreProgression(i + 1, total)}\``);

        await ticket.send({ embeds: [embed] });

        const messages = await ticket
            .awaitMessages({
                filter: m => m.author.id === user.id && m.content.trim().length > 0,
                max: 1,
                time: CONFIG.tempsParQuestionMs,
                errors: ['time']
            })
            .catch(() => null);

        if (!messages || messages.size === 0) {
            await ticket.send('⌛ Temps écoulé. Ta candidature est annulée, ce salon va être supprimé.');
            return null;
        }

        const reponse = messages.first().content.trim();

        if (reponse.toLowerCase() === 'annuler') {
            await ticket.send('❌ Ta candidature a été annulée, ce salon va être supprimé.');
            return null;
        }

        reponses.push(reponse);
    }

    return reponses;
}

async function envoyerCandidature(ticket, user, reponses) {
    const creation = Math.floor(user.createdTimestamp / 1000);

    const embed = new EmbedBuilder()
        .setColor(CONFIG.couleur)
        .setTitle('📋 NOUVELLE CANDIDATURE MBZ')
        .setDescription(
            `**Candidat :** ${user}\n` +
            `**ID Discord :** \`${user.id}\`\n` +
            `**Compte créé :** <t:${creation}:R>`
        )
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields([
            ...QUESTIONS.map((q, i) => ({
                name: q.champ,
                value: couper(reponses[i]) || '—',
                inline: q.inline
            })),
            { name: VOTE_FIELD, value: formaterVotes({ pour: [], contre: [] }) },
            { name: STATUS_FIELD, value: STATUS_PENDING }
        ])
        .setFooter({ text: CONFIG.footer })
        .setTimestamp();

    await ticket.send({
        content: `${STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}> ` : '📢 '}Nouvelle candidature de ${user} !`,
        embeds: [embed],
        components: boutonsDecision({ pour: [], contre: [] }),
        allowedMentions: {
            users: [user.id],
            roles: STAFF_ROLE_ID ? [STAFF_ROLE_ID] : []
        }
    });

    const merci = new EmbedBuilder()
        .setColor(CONFIG.couleurOk)
        .setTitle('✅ CANDIDATURE ENVOYÉE')
        .setDescription(
            `Merci ${user} ! Ta candidature a bien été transmise.\n\n` +
            `🎙️ **Tu seras recontacté par les leads pour passer un entretien vocal.**\n` +
            `Reste disponible !`
        )
        .setFooter({ text: CONFIG.footer });

    await ticket.send({
        content: `${user}`,
        embeds: [merci],
        allowedMentions: { users: [user.id] }
    });
}

// ============================================================
//  ACTIONS
// ============================================================

async function postuler(interaction) {
    const { guild, user } = interaction;

    if (!guild || guild.id !== GUILD_ID) {
        return repondre(interaction, '❌ Serveur de recrutement incorrect.');
    }

    // On répond tout de suite (Discord coupe au bout de 3 secondes)
    await interaction.deferReply({ flags: EPHEMERAL });

    const existant = ticketExistant(guild, user.id);
    if (existant || creationEnCours.has(user.id)) {
        return interaction.editReply({
            content: existant
                ? `❌ Tu as déjà une candidature en cours : ${existant}`
                : '❌ Ta candidature est déjà en cours de création.'
        });
    }

    creationEnCours.add(user.id);
    let ticket;

    try {
        ticket = await creerTicket(guild, user);
        await interaction.editReply({ content: `✅ Ton ticket a été créé : ${ticket}` });
    } catch (error) {
        console.error('Erreur création ticket :', error);
        await interaction
            .editReply({
                content: '❌ Impossible de créer ton ticket. Contacte le staff.'
            })
            .catch(() => {});
        return;
    } finally {
        creationEnCours.delete(user.id);
    }

    try {
        const reponses = await poserQuestions(ticket, user);

        if (!reponses) {
            setTimeout(() => ticket.delete().catch(() => {}), 8000);
            return;
        }

        await envoyerCandidature(ticket, user, reponses);
        console.log(`✅ Candidature terminée : ${user.tag}`);
    } catch (error) {
        console.error('Erreur candidature :', error);
        await ticket
            .send('⚠️ Une erreur est survenue pendant cette candidature. Le staff peut intervenir.')
            .catch(() => {});
    }
}

async function voter(interaction) {
    const ancien = interaction.message.embeds[0];
    if (!ancien) return interaction.deferUpdate();

    const statut = ancien.fields?.find(f => f.name === STATUS_FIELD)?.value || '';
    if (statut && !statut.startsWith('⏳')) {
        return repondre(interaction, '⚠️ Une décision a déjà été prise.');
    }

    const votes = lireVotes(ancien);
    const uid = interaction.user.id;
    const camp = interaction.customId === 'mbz_vote_pour' ? 'pour' : 'contre';
    const dejaDeCeCote = votes[camp].includes(uid);

    // Un seul vote par personne : on retire l'ancien, recliquer annule
    votes.pour = votes.pour.filter(id => id !== uid);
    votes.contre = votes.contre.filter(id => id !== uid);
    if (!dejaDeCeCote) votes[camp].push(uid);

    const embed = remplacerChamp(EmbedBuilder.from(ancien), VOTE_FIELD, formaterVotes(votes));

    return interaction.update({
        embeds: [embed],
        components: boutonsDecision(votes)
    });
}

async function decider(interaction, acceptee, motif) {
    const { guild, channel } = interaction;
    const candidatId = candidatIdDuTicket(channel);

    if (!candidatId) {
        return repondre(interaction, '❌ Ce salon n’est pas un ticket de candidature.');
    }

    const ancien = interaction.message.embeds[0];
    const statut = ancien?.fields?.find(f => f.name === STATUS_FIELD)?.value || STATUS_PENDING;

    if (!statut.startsWith('⏳')) {
        return repondre(interaction, '⚠️ Une décision a déjà été prise.');
    }

    const votes = lireVotes(ancien);

    // Met à jour la carte de candidature (couleur, titre, statut)
    if (ancien) {
        const texteStatut = acceptee
            ? `✅ **Acceptée** par ${interaction.user}`
            : `❌ **Refusée** par ${interaction.user}` + (motif ? `\n**Motif :** ${couper(motif, 500)}` : '');

        const embed = remplacerChamp(EmbedBuilder.from(ancien), STATUS_FIELD, texteStatut)
            .setColor(acceptee ? CONFIG.couleurOk : CONFIG.couleurNon)
            .setTitle(acceptee ? '✅ CANDIDATURE ACCEPTÉE' : '❌ CANDIDATURE REFUSÉE');

        await interaction.message
            .edit({ embeds: [embed], components: [boutonFermerSeul()] })
            .catch(() => {});
    }

    // Annonce dans le ticket
    const annonce = new EmbedBuilder()
        .setColor(acceptee ? CONFIG.couleurOk : CONFIG.couleurNon)
        .setTitle(acceptee ? '✅ Candidature acceptée' : '❌ Candidature refusée')
        .setDescription(`Décision prise par ${interaction.user}.`)
        .setTimestamp();
    if (!acceptee && motif) annonce.addFields({ name: 'Motif', value: couper(motif, 900) });

    await channel.send({
        content: `<@${candidatId}>`,
        embeds: [annonce],
        allowedMentions: { users: [candidatId] }
    });

    // Message privé au candidat
    const candidat = await client.users.fetch(candidatId).catch(() => null);
    if (candidat) {
        const mp = new EmbedBuilder()
            .setColor(acceptee ? CONFIG.couleurOk : CONFIG.couleurNon)
            .setTitle(acceptee ? '🎉 Félicitations !' : 'Réponse à ta candidature')
            .setDescription(
                acceptee
                    ? 'Ta candidature **Miami Boyz** a été **acceptée**.\n\n' +
                      '🎙️ Les leads te contacteront pour organiser ton entretien vocal. Reste disponible !'
                    : 'Merci pour ta candidature **Miami Boyz**.\n\n' +
                      'Après étude, elle n’a malheureusement **pas été retenue**.' +
                      (motif ? `\n\n**Motif :** ${couper(motif, 900)}` : '') +
                      '\n\nBonne continuation !'
            )
            .setFooter({ text: CONFIG.footer });

        await candidat.send({ embeds: [mp] }).catch(() => {
            channel.send('⚠️ Impossible d’envoyer un message privé au candidat (MP fermés).').catch(() => {});
        });
    }

    // Rôles automatiques si accepté
    if (acceptee && ACCEPTED_ROLE_IDS.length) {
        const membre = await guild.members.fetch(candidatId).catch(() => null);
        if (membre) {
            await membre.roles.add(ACCEPTED_ROLE_IDS).catch(error => {
                console.error('Impossible de donner les rôles :', error.message);
                channel
                    .send('⚠️ Je n’ai pas pu donner le(s) rôle(s) : mon rôle doit être placé **au-dessus** dans la liste des rôles.')
                    .catch(() => {});
            });
        }
    }

    // Log
    await envoyerLog(guild, {
        embeds: [
            new EmbedBuilder()
                .setColor(acceptee ? CONFIG.couleurOk : CONFIG.couleurNon)
                .setTitle(acceptee ? 'Candidature acceptée' : 'Candidature refusée')
                .addFields(
                    { name: 'Candidat', value: `<@${candidatId}>`, inline: true },
                    { name: 'Décision par', value: `${interaction.user}`, inline: true },
                    { name: 'Votes du staff', value: `👍 ${votes.pour.length} · 👎 ${votes.contre.length}` },
                    ...(motif ? [{ name: 'Motif', value: couper(motif, 900) }] : [])
                )
                .setTimestamp()
        ]
    });

    console.log(`${acceptee ? 'ACCEPTÉE' : 'REFUSÉE'} : ${candidat ? candidat.tag : candidatId}`);
}

function ouvrirModalRefus(interaction) {
    const ancien = interaction.message.embeds[0];
    const statut = ancien?.fields?.find(f => f.name === STATUS_FIELD)?.value || STATUS_PENDING;

    if (!statut.startsWith('⏳')) {
        return repondre(interaction, '⚠️ Une décision a déjà été prise.');
    }

    const modal = new ModalBuilder()
        .setCustomId('mbz_modal_refus')
        .setTitle('Refuser la candidature');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('motif')
                .setLabel('Motif du refus (optionnel)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(900)
        )
    );

    return interaction.showModal(modal);
}

async function construireTranscript(channel) {
    let tous = [];
    let dernierId;

    for (let i = 0; i < 5; i++) {
        const lot = await channel.messages.fetch({ limit: 100, before: dernierId });
        if (lot.size === 0) break;
        tous = tous.concat([...lot.values()]);
        dernierId = lot.last().id;
        if (lot.size < 100) break;
    }

    tous.reverse();

    return tous
        .map(m => {
            const date = m.createdAt.toLocaleString('fr-FR');
            const embeds = m.embeds
                .map(e => {
                    const champs = (e.fields || []).map(f => `   • ${f.name} : ${f.value}`).join('\n');
                    return `[Carte] ${e.title || ''} ${e.description || ''}\n${champs}`;
                })
                .join('\n');
            return `[${date}] ${m.author.tag} : ${m.content || ''}${embeds ? '\n' + embeds : ''}`;
        })
        .join('\n');
}

async function fermer(interaction) {
    const { guild, channel } = interaction;

    // Sécurité : on ne supprime que de vrais tickets de candidature
    if (!candidatIdDuTicket(channel)) {
        return repondre(interaction, '❌ Ce salon n’est pas un ticket de candidature.');
    }

    await interaction.reply({
        content: `🔒 Ticket fermé par ${interaction.user}. Suppression dans 5 secondes…`
    });

    const transcript = await construireTranscript(channel).catch(() => null);
    if (transcript) {
        const fichier = new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), {
            name: `transcript-${channel.name}.txt`
        });
        await envoyerLog(guild, {
            content: `🔒 Ticket **${channel.name}** fermé par ${interaction.user}.`,
            files: [fichier]
        });
    }

    setTimeout(() => channel.delete().catch(console.error), 5000);
}

// ============================================================
//  DÉMARRAGE
// ============================================================

const commandeRecrutement = new SlashCommandBuilder()
    .setName('recrutement')
    .setDescription('Publier le panneau de recrutement MBZ dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

client.once(Events.ClientReady, async bot => {
    console.log(`✅ Connecté en tant que ${bot.user.tag}`);

    try {
        const guild = await bot.guilds.fetch(GUILD_ID);
        await guild.channels.fetch().catch(() => {});
        await guild.commands.set([commandeRecrutement.toJSON()]);
        console.log('✅ Commande /recrutement enregistrée');
    } catch (error) {
        console.error('❌ Erreur au démarrage (GUILD_ID correct ? bot invité ?) :', error.message);
    }
});

// ============================================================
//  INTERACTIONS
// ============================================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        // /recrutement
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'recrutement') {
                await envoyerPanneau(interaction.channel);
                return interaction.reply({
                    content: '✅ Panneau de recrutement publié !',
                    flags: EPHEMERAL
                });
            }
            return;
        }

        // Boutons
        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'mbz_postuler') return await postuler(interaction);
            if (!id.startsWith('mbz_')) return;

            if (!estStaff(interaction)) {
                return repondre(interaction, '⛔ Réservé aux leads et au staff.');
            }

            if (id === 'mbz_vote_pour' || id === 'mbz_vote_contre') return await voter(interaction);

            if (id === 'mbz_accepter') {
                await interaction.deferUpdate();
                return await decider(interaction, true);
            }

            if (id === 'mbz_refuser') return await ouvrirModalRefus(interaction);
            if (id === 'mbz_fermer') return await fermer(interaction);
            return;
        }

        // Fenêtre de refus
        if (interaction.isModalSubmit() && interaction.customId === 'mbz_modal_refus') {
            if (!estStaff(interaction)) {
                return repondre(interaction, '⛔ Accès refusé.');
            }
            await interaction.deferUpdate();
            const motif = interaction.fields.getTextInputValue('motif').trim();
            return await decider(interaction, false, motif);
        }
    } catch (error) {
        console.error('Erreur interaction :', error);
        await repondre(interaction, '❌ Une erreur est survenue. Réessaie ou contacte le staff.');
    }
});

// ============================================================
//  ERREURS & CONNEXION
// ============================================================

client.on('error', error => console.error('Erreur Discord :', error));
process.on('unhandledRejection', error => console.error('Erreur non gérée :', error));

client.login(TOKEN).catch(error => {
    console.error('❌ Connexion impossible :', error.message);
});
