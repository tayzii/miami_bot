
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
    Events,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

// ===================================
// CONFIGURATION
// ===================================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LEAD_ROLE_ID = process.env.LEAD_ROLE_ID || '';

const CATEGORY_NAME = '📂 CANDIDATURES';

const QUESTIONS = [
    'Combien tu as d’heures sur FiveM ?',
    'Quel est ton âge (IRL) ?',
    'Quelle est ton expérience RP ? (serveurs, groupes illégaux précédents...)',
    'Quelles sont tes qualités en RP ?',
    'Quels sont tes défauts ?'
];

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('❌ TOKEN, CLIENT_ID et GUILD_ID sont obligatoires dans .env');
    process.exit(1);
}

if (![CLIENT_ID, GUILD_ID].every(id => /^\d+$/.test(id))) {
    console.error('❌ CLIENT_ID et GUILD_ID doivent être numériques.');
    process.exit(1);
}

// ===================================
// CLIENT DISCORD
// ===================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ]
});

const ticketsEnCours = new Set();

// ===================================
// COMMANDES
// ===================================

const commandes = [
    new SlashCommandBuilder()
        .setName('recrutement')
        .setDescription('Publier le panneau de recrutement MBZ')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName('setuprecrutement')
        .setDescription('Configurer le système de recrutement MBZ')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// ===================================
// ENREGISTREMENT DES COMMANDES
// ===================================

async function enregistrerCommandes() {
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);

        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commandes.map(c => c.toJSON()) }
        );

        console.log('✅ Commandes Discord enregistrées.');
    } catch (error) {
        console.error('❌ Erreur commandes :', error.message);
    }
}

// ===================================
// VÉRIFICATION DU STAFF
// ===================================

function estLead(interaction) {
    if (!interaction.inGuild()) return false;

    if (interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageChannels
    )) {
        return true;
    }

    if (LEAD_ROLE_ID) {
        const roles = interaction.member?.roles;

        if (roles?.cache?.has(LEAD_ROLE_ID)) {
            return true;
        }
    }

    return false;
}

// ===================================
// CATÉGORIE DES TICKETS
// ===================================

async function obtenirCategorie(guild) {
    let categorie = guild.channels.cache.find(
        channel =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === CATEGORY_NAME
    );

    if (!categorie) {
        categorie = await guild.channels.create({
            name: CATEGORY_NAME,
            type: ChannelType.GuildCategory
        });
    }

    return categorie;
}

// ===================================
// CRÉATION DU TICKET
// ===================================

async function creerTicket(guild, user) {
    const categorie = await obtenirCategorie(guild);

    const permissions = [
        {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },
        {
            id: client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels
            ]
        }
    ];

    if (LEAD_ROLE_ID) {
        permissions.push({
            id: LEAD_ROLE_ID,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    return guild.channels.create({
        name: `candidature-${user.username}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '')
            .slice(0, 85),
        type: ChannelType.GuildText,
        parent: categorie.id,
        permissionOverwrites: permissions
    });
}

// ===================================
// PANNEAU DE RECRUTEMENT
// ===================================

async function envoyerPanneau(channel) {
    const embed = new EmbedBuilder()
        .setColor('#D4AF37')
        .setTitle('🌴 MIAMI BOYZ | RECRUTEMENT')
        .setDescription(
            '**Les recrutements sont ouverts !**\n\n' +
            'Tu souhaites rejoindre les Miami Boyz ?\n\n' +
            '📋 Clique sur **POSTULER** pour ouvrir ton ticket.\n' +
            '📝 Tu devras répondre à 5 questions.\n' +
            '🎙️ Les leads pourront ensuite te contacter pour un entretien vocal.\n\n' +
            '**Bonne chance à tous !**'
        )
        .setFooter({ text: 'MBZ Recrutement' })
        .setTimestamp();

    const boutons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mbz_postuler')
            .setLabel('POSTULER')
            .setEmoji('📋')
            .setStyle(ButtonStyle.Success)
    );

    await channel.send({
        embeds: [embed],
        components: [boutons]
    });
}

// ===================================
// QUESTIONS
// ===================================

async function poserQuestions(ticket, user) {
    const reponses = [];

    const intro = new EmbedBuilder()
        .setColor('#D4AF37')
        .setTitle('🎫 CANDIDATURE MIAMI BOYZ')
        .setDescription(
            `Bienvenue ${user} !\n\n` +
            'Tu vas répondre à 5 questions.\n' +
            'Réponds directement dans ce ticket.\n\n' +
            '⏱️ Temps disponible : 5 minutes par question.\n' +
            '❌ Écris **annuler** pour abandonner.'
        );

    await ticket.send({
        content: `${user}`,
        embeds: [intro],
        allowedMentions: { users: [user.id] }
    });

    for (let i = 0; i < QUESTIONS.length; i++) {
        const embed = new EmbedBuilder()
            .setColor('#D4AF37')
            .setTitle(`QUESTION ${i + 1}/5`)
            .setDescription(QUESTIONS[i]);

        await ticket.send({ embeds: [embed] });

        const messages = await ticket.awaitMessages({
            filter: message => message.author.id === user.id,
            max: 1,
            time: 300000,
            errors: ['time']
        }).catch(() => null);

        if (!messages || messages.size === 0) {
            await ticket.send('⌛ Temps écoulé. Ta candidature est annulée.');
            return null;
        }

        const reponse = messages.first().content.trim();

        if (reponse.toLowerCase() === 'annuler') {
            await ticket.send('❌ Ta candidature a été annulée.');
            return null;
        }

        if (!reponse) {
            await ticket.send('❌ Réponse vide. Candidature annulée.');
            return null;
        }

        reponses.push(reponse);
    }

    return reponses;
}

// ===================================
// ENVOI DE LA CANDIDATURE
// ===================================

async function envoyerCandidature(ticket, user, reponses) {
    const embed = new EmbedBuilder()
        .setColor('#D4AF37')
        .setTitle('📋 NOUVELLE CANDIDATURE MBZ')
        .setDescription(
            `**Candidat :** ${user}\n` +
            `**ID Discord :** ${user.id}`
        )
        .setThumbnail(user.displayAvatarURL())
        .addFields(
            { name: '1️⃣ Heures FiveM', value: reponses[0].slice(0, 1024) },
            { name: '2️⃣ Âge IRL', value: reponses[1].slice(0, 1024) },
            { name: '3️⃣ Expérience RP', value: reponses[2].slice(0, 1024) },
            { name: '4️⃣ Qualités RP', value: reponses[3].slice(0, 1024) },
            { name: '5️⃣ Défauts', value: reponses[4].slice(0, 1024) }
        )
        .setFooter({ text: 'Miami Boyz • Recrutement' })
        .setTimestamp();

    const boutons = new ActionRowBuilder().addComponents(
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
    );

    const notification = LEAD_ROLE_ID
        ? `<@&${LEAD_ROLE_ID}>`
        : '📢 Leads';

    await ticket.send({
        content: `${notification} Nouvelle candidature de ${user} !`,
        embeds: [embed],
        components: [boutons],
        allowedMentions: {
            users: [user.id],
            roles: LEAD_ROLE_ID ? [LEAD_ROLE_ID] : []
        }
    });

    await ticket.send({
        content:
            `${user} **Tu seras recontacté par les leads pour passer un entretien vocal. Reste disponible !**`,
        allowedMentions: { users: [user.id] }
    });
}

// ===================================
// DÉMARRAGE DU BOT
// ===================================

client.once(Events.ClientReady, async bot => {
    console.log(`✅ Connecté en tant que ${bot.user.tag}`);
    await enregistrerCommandes();
});

// ===================================
// INTERACTIONS
// ===================================

client.on(Events.InteractionCreate, async interaction => {

    // Commande /recrutement
    if (interaction.isChatInputCommand()) {

        if (interaction.commandName === 'recrutement') {
            try {
                await envoyerPanneau(interaction.channel);

                await interaction.reply({
                    content: '✅ Panneau de recrutement publié !',
                    ephemeral: true
                });
            } catch (error) {
                console.error(error);

                if (!interaction.replied) {
                    await interaction.reply({
                        content: '❌ Impossible de publier le panneau.',
                        ephemeral: true
                    });
                }
            }
        }

        if (interaction.commandName === 'setuprecrutement') {
            try {
                await obtenirCategorie(interaction.guild);

                await interaction.reply({
                    content: '✅ Catégorie des candidatures créée ou trouvée !',
                    ephemeral: true
                });
            } catch (error) {
                console.error(error);

                await interaction.reply({
                    content: '❌ Erreur pendant la configuration.',
                    ephemeral: true
                });
            }
        }

        return;
    }

    if (!interaction.isButton()) return;

    // ===================================
    // BOUTON POSTULER
    // ===================================

    if (interaction.customId === 'mbz_postuler') {
        const guild = interaction.guild;
        const user = interaction.user;

        if (!guild || guild.id !== GUILD_ID) {
            return interaction.reply({
                content: '❌ Serveur de recrutement incorrect.',
                ephemeral: true
            });
        }

        if (ticketsEnCours.has(user.id)) {
            return interaction.reply({
                content: '❌ Tu as déjà une candidature en cours.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        ticketsEnCours.add(user.id);

        let ticket;

        try {
            ticket = await creerTicket(guild, user);

            await interaction.editReply({
                content: `✅ Ton ticket a été créé : ${ticket}`
            });

            const reponses = await poserQuestions(ticket, user);

            if (!reponses) return;

            await envoyerCandidature(ticket, user, reponses);

            console.log(`✅ Candidature terminée : ${user.tag}`);

        } catch (error) {
            console.error('Erreur candidature :', error);

            await interaction.editReply({
                content: '❌ Impossible de terminer ta candidature. Contacte le staff.'
            }).catch(() => {});

            if (ticket) {
                await ticket.send(
                    '⚠️ Une erreur est survenue pendant cette candidature. Le staff peut intervenir.'
                ).catch(() => {});
            }

        } finally {
            ticketsEnCours.delete(user.id);
        }

        return;
    }

    // ===================================
    // BOUTON FERMER
    // ===================================

    if (interaction.customId === 'mbz_fermer') {
        if (!estLead(interaction)) {
            return interaction.reply({
                content: '❌ Réservé aux leads et au staff.',
                ephemeral: true
            });
        }

        const channel = interaction.channel;

        await interaction.reply({
            content: `🔒 Ticket fermé par ${interaction.user.tag}. Suppression dans 5 secondes.`
        });

        setTimeout(() => {
            channel.delete().catch(console.error);
        }, 5000);

        return;
    }

    // ===================================
    // ACCEPTER / REFUSER
    // ===================================

    if (['mbz_accepter', 'mbz_refuser'].includes(interaction.customId)) {

        if (!estLead(interaction)) {
            return interaction.reply({
                content: '❌ Seuls les leads et le staff autorisé peuvent décider.',
                ephemeral: true
            });
        }

        // Évite plusieurs décisions sur la même candidature
        if (interaction.message.components.length === 0) {
            return interaction.reply({
                content: '⚠️ Une décision a déjà été prise.',
                ephemeral: true
            });
        }

        const channel = interaction.channel;

        const candidatId = channel.permissionOverwrites.cache.find(
            overwrite =>
                overwrite.type === 1 &&
                overwrite.allow.has(PermissionFlagsBits.ViewChannel)
                && overwrite.id !== client.user.id
        )?.id;

        if (!candidatId) {
            return interaction.reply({
                content: '❌ Impossible de retrouver le candidat.',
                ephemeral: true
            });
        }

        const acceptee = interaction.customId === 'mbz_accepter';

        await interaction.deferUpdate();

        const embedDecision = new EmbedBuilder()
            .setColor(acceptee ? '#2ECC71' : '#E74C3C')
            .setTitle(
                acceptee
                    ? '✅ CANDIDATURE ACCEPTÉE'
                    : '❌ CANDIDATURE REFUSÉE'
            )
            .setDescription(
                `Décision prise par ${interaction.user}.\n` +
                `Candidat : <@${candidatId}>`
            )
            .setTimestamp();

        await interaction.message.edit({
            embeds: [
                ...interaction.message.embeds,
                embedDecision
            ],
            components: []
        });

        const candidat = await client.users.fetch(candidatId);

        try {
            await candidat.send(
                acceptee
                    ? '🎉 Félicitations ! Ta candidature Miami Boyz a été acceptée. Les leads te contacteront pour organiser ton entretien vocal. Reste disponible !'
                    : 'Merci pour ta candidature Miami Boyz. Après étude, ta candidature n’a malheureusement pas été retenue. Bonne continuation !'
            );
        } catch {
            await channel.send(
                '⚠️ Impossible d’envoyer un message privé au candidat.'
            );
        }

        await channel.send(
            acceptee
                ? `✅ Candidature acceptée par ${interaction.user}.`
                : `❌ Candidature refusée par ${interaction.user}.`
        );

        console.log(
            `${acceptee ? 'ACCEPTÉE' : 'REFUSÉE'} : ${candidat.tag}`
        );

        return;
    }
});

// ===================================
// ERREURS
// ===================================

client.on('error', error => {
    console.error('Erreur Discord :', error);
});

process.on('unhandledRejection', error => {
    console.error('Erreur non gérée :', error);
});

// ===================================
// CONNEXION
// ===================================

client.login(TOKEN).catch(error => {
    console.error('❌ Connexion impossible :', error.message);
});
