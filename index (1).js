require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  AttachmentBuilder,
  Events,
} = require('discord.js');
const config = require('./config.json');

const {
  TOKEN,
  GUILD_ID,
  STAFF_ROLE_ID,
  CATEGORY_ID,
  LOG_CHANNEL_ID,
  ACCEPTED_ROLE_ID,
} = process.env;

if (!TOKEN || !GUILD_ID) {
  console.error('❌ TOKEN et GUILD_ID sont obligatoires dans le fichier .env');
  process.exit(1);
}

const client = new Client({
  // MessageContent est un intent "privilégié" : à activer dans le Developer Portal
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const TOPIC_PREFIX = 'candidat:';

// ───────────────────────── Utilitaires ─────────────────────────

const isStaff = (member) =>
  (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID)) ||
  member.permissions.has(PermissionFlagsBits.Administrator);

const getApplicantId = (channel) =>
  channel.topic && channel.topic.startsWith(TOPIC_PREFIX)
    ? channel.topic.slice(TOPIC_PREFIX.length)
    : null;

async function sendLog(guild, payload) {
  if (!LOG_CHANNEL_ID) return;
  const channel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (channel) await channel.send(payload).catch(() => {});
}

const VOTE_FIELD = '🗳️ Votes du staff';

function parseVotes(embed) {
  const votes = { yes: [], no: [] };
  const field = embed && embed.fields ? embed.fields.find((f) => f.name === VOTE_FIELD) : null;
  if (!field) return votes;
  for (const line of field.value.split('\n')) {
    const ids = [...line.matchAll(/<@(\d+)>/g)].map((m) => m[1]);
    if (line.startsWith('👍')) votes.yes = ids;
    else if (line.startsWith('👎')) votes.no = ids;
  }
  return votes;
}

function formatVotes(votes) {
  const list = (arr) => (arr.length ? arr.map((id) => `<@${id}>`).join(' ') : '—');
  return `👍 Pour (${votes.yes.length}) : ${list(votes.yes)}\n👎 Contre (${votes.no.length}) : ${list(votes.no)}`;
}

function decisionRows(votes) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('vote_yes')
        .setLabel(`Pour (${votes.yes.length})`)
        .setEmoji('👍')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('vote_no')
        .setLabel(`Contre (${votes.no.length})`)
        .setEmoji('👎')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('accept')
        .setLabel('Accepter')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('refuse')
        .setLabel('Refuser')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('close')
        .setLabel('Fermer le ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function closeOnlyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close')
      .setLabel('Fermer le ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary),
  );
}

async function buildTranscript(channel) {
  let all = [];
  let lastId;
  // Récupère jusqu'à 500 messages
  for (let i = 0; i < 5; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId });
    if (batch.size === 0) break;
    all = all.concat([...batch.values()]);
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }
  all.reverse();

  const lines = all.map((m) => {
    const date = m.createdAt.toLocaleString('fr-FR');
    const content = m.content || '';
    const embeds = m.embeds
      .map((e) => {
        const fields = (e.fields || []).map((f) => `  • ${f.name}: ${f.value}`).join('\n');
        return `[Embed] ${e.title || ''} ${e.description || ''}\n${fields}`;
      })
      .join('\n');
    return `[${date}] ${m.author.tag}: ${content}${embeds ? '\n' + embeds : ''}`;
  });
  return lines.join('\n');
}

// ───────────────────────── Questionnaire ─────────────────────────

async function runQuestionnaire(channel, user) {
  const answers = [];
  const timeoutMs = (config.answerTimeoutMinutes || 10) * 60 * 1000;
  const total = config.questions.length;

  await channel.send(
    `👋 Bienvenue ${user} ! Je vais te poser **${total} questions**. ` +
      `Réponds simplement par un message à chaque fois.`,
  );

  for (let i = 0; i < total; i++) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(config.panel.color)
          .setTitle(`Question ${i + 1}/${total}`)
          .setDescription(config.questions[i]),
      ],
    });

    try {
      const collected = await channel.awaitMessages({
        filter: (m) => m.author.id === user.id && m.content.trim().length > 0,
        max: 1,
        time: timeoutMs,
        errors: ['time'],
      });
      answers.push(collected.first().content.slice(0, 1000));
    } catch {
      await channel.send(
        '⏰ Temps écoulé : candidature annulée. Ce salon sera supprimé dans 10 secondes.',
      );
      setTimeout(() => channel.delete().catch(() => {}), 10_000);
      return;
    }
  }

  const recap = new EmbedBuilder()
    .setColor('#F1C40F')
    .setTitle(`📨 Candidature de ${user.username}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields([
      ...config.questions.map((q, i) => ({
        name: `${i + 1}. ${q}`.slice(0, 256),
        value: answers[i] || '—',
      })),
      { name: VOTE_FIELD, value: formatVotes({ yes: [], no: [] }) },
    ])
    .setFooter({ text: `ID : ${user.id}` })
    .setTimestamp();

  await channel.send({
    content: `${STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}> ` : ''}Une nouvelle candidature est prête à être examinée.`,
    embeds: [recap],
    components: decisionRows({ yes: [], no: [] }),
  });

  await channel.send(config.finalMessage.replace('{user}', `${user}`));
}

// ───────────────────────── Décisions ─────────────────────────

async function handleDecision(interaction, accepted, reason) {
  const guild = interaction.guild;
  const channel = interaction.channel;
  const applicantId = getApplicantId(channel);
  if (!applicantId) {
    return interaction.followUp({ content: 'Ce salon n’est pas un ticket valide.', ephemeral: true });
  }

  const votes = parseVotes(interaction.message.embeds[0]);

  // Désactive Accepter/Refuser pour éviter une double décision
  await interaction.message.edit({ components: [closeOnlyRow()] }).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor(accepted ? '#2ECC71' : '#E74C3C')
    .setTitle(accepted ? '✅ Candidature acceptée' : '❌ Candidature refusée')
    .setDescription(`Décision prise par ${interaction.user}.`)
    .setTimestamp();
  if (!accepted && reason) embed.addFields({ name: 'Motif', value: reason.slice(0, 1000) });

  await channel.send({ content: `<@${applicantId}>`, embeds: [embed] });

  // MP au candidat
  const applicant = await client.users.fetch(applicantId).catch(() => null);
  if (applicant) {
    const dm = new EmbedBuilder()
      .setColor(accepted ? '#2ECC71' : '#E74C3C')
      .setTitle(accepted ? '🎉 Félicitations !' : 'Réponse à ta candidature')
      .setDescription(
        accepted
          ? `Ta candidature sur **${guild.name}** a été **acceptée**.`
          : `Ta candidature sur **${guild.name}** a été **refusée**.` +
              (reason ? `\n\n**Motif :** ${reason}` : ''),
      );
    await applicant.send({ embeds: [dm] }).catch(() => {
      channel.send('⚠️ Impossible d’envoyer un MP au candidat (MP fermés).').catch(() => {});
    });
  }

  // Rôle automatique si accepté
  const acceptedRoleIds = (ACCEPTED_ROLE_ID || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (accepted && acceptedRoleIds.length) {
    const member = await guild.members.fetch(applicantId).catch(() => null);
    if (member) {
      await member.roles.add(acceptedRoleIds).catch((err) => {
        console.error('Impossible d’ajouter le rôle :', err.message);
        channel.send('⚠️ Je n’ai pas pu donner le rôle (vérifie ma hiérarchie de rôles).').catch(() => {});
      });
    }
  }

  await sendLog(guild, {
    embeds: [
      new EmbedBuilder()
        .setColor(accepted ? '#2ECC71' : '#E74C3C')
        .setTitle(accepted ? 'Candidature acceptée' : 'Candidature refusée')
        .addFields(
          { name: 'Candidat', value: `<@${applicantId}>`, inline: true },
          { name: 'Staff', value: `${interaction.user}`, inline: true },
          { name: 'Votes du staff', value: `👍 ${votes.yes.length} · 👎 ${votes.no.length}` },
          ...(reason ? [{ name: 'Motif', value: reason.slice(0, 1000) }] : []),
        )
        .setTimestamp(),
    ],
  });
}

async function handleClose(interaction) {
  const channel = interaction.channel;
  await interaction.reply('🔒 Fermeture du ticket dans 5 secondes…');

  const transcript = await buildTranscript(channel).catch(() => null);
  if (transcript) {
    const file = new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), {
      name: `transcript-${channel.name}.txt`,
    });
    await sendLog(interaction.guild, {
      content: `🔒 Ticket **${channel.name}** fermé par ${interaction.user}.`,
      files: [file],
    });
  }

  setTimeout(() => channel.delete().catch(() => {}), 5_000);
}

// ───────────────────────── Événements ─────────────────────────

client.once(Events.ClientReady, async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID);
  const command = new SlashCommandBuilder()
    .setName('panel-recrutement')
    .setDescription('Poste le panneau de candidature dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON();
  await guild.commands.set([command]);
  console.log('✅ Commande /panel-recrutement enregistrée');
});

client.on('interactionCreate', async (interaction) => {
  try {
    // /panel-recrutement
    if (interaction.isChatInputCommand() && interaction.commandName === 'panel-recrutement') {
      const embed = new EmbedBuilder()
        .setColor(config.panel.color)
        .setDescription(config.panel.description);
      if (config.panel.title) embed.setTitle(config.panel.title);
      if (config.panel.conditions && config.panel.conditions.length) {
        embed.addFields({
          name: 'Conditions',
          value: config.panel.conditions.map((c) => `• ${c}`).join('\n'),
        });
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('apply')
          .setLabel(config.panel.buttonLabel)
          .setEmoji('📝')
          .setStyle(ButtonStyle.Success),
      );
      await interaction.channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: '✅ Panneau envoyé.', ephemeral: true });
    }

    // Bouton Postuler
    if (interaction.isButton() && interaction.customId === 'apply') {
      const guild = interaction.guild;
      const user = interaction.user;

      const existing = guild.channels.cache.find((c) => c.topic === `${TOPIC_PREFIX}${user.id}`);
      if (existing) {
        return interaction.reply({
          content: `Tu as déjà une candidature en cours : ${existing}`,
          ephemeral: true,
        });
      }

      const channel = await guild.channels.create({
        name: `candidature-${user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORY_ID || null,
        topic: `${TOPIC_PREFIX}${user.id}`,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
            ],
          },
          ...(STAFF_ROLE_ID
            ? [
                {
                  id: STAFF_ROLE_ID,
                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                  ],
                },
              ]
            : []),
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });

      await interaction.reply({ content: `✅ Ton ticket est créé : ${channel}`, ephemeral: true });
      runQuestionnaire(channel, user).catch((e) => console.error('Erreur questionnaire :', e));
      return;
    }

    // Boutons staff
    if (interaction.isButton() && ['vote_yes', 'vote_no', 'accept', 'refuse', 'close'].includes(interaction.customId)) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: '⛔ Seul le staff peut utiliser ce bouton.',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'vote_yes' || interaction.customId === 'vote_no') {
        const oldEmbed = interaction.message.embeds[0];
        if (!oldEmbed) return interaction.deferUpdate();

        const votes = parseVotes(oldEmbed);
        const uid = interaction.user.id;
        const side = interaction.customId === 'vote_yes' ? 'yes' : 'no';
        const alreadyThisSide = votes[side].includes(uid);

        votes.yes = votes.yes.filter((id) => id !== uid);
        votes.no = votes.no.filter((id) => id !== uid);
        if (!alreadyThisSide) votes[side].push(uid);

        const fields = (oldEmbed.fields || []).map((f) => ({ name: f.name, value: f.value, inline: f.inline }));
        const idx = fields.findIndex((f) => f.name === VOTE_FIELD);
        const voteField = { name: VOTE_FIELD, value: formatVotes(votes) };
        if (idx >= 0) fields[idx] = voteField;
        else fields.push(voteField);

        const embed = EmbedBuilder.from(oldEmbed).setFields(fields);
        return interaction.update({ embeds: [embed], components: decisionRows(votes) });
      }

      if (interaction.customId === 'accept') {
        await interaction.deferUpdate();
        return handleDecision(interaction, true);
      }

      if (interaction.customId === 'refuse') {
        const modal = new ModalBuilder().setCustomId('refuse_modal').setTitle('Refuser la candidature');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Motif du refus (optionnel)')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(900),
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'close') {
        return handleClose(interaction);
      }
    }

    // Modal de refus
    if (interaction.isModalSubmit() && interaction.customId === 'refuse_modal') {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: '⛔ Accès refusé.', ephemeral: true });
      }
      await interaction.deferUpdate();
      const reason = interaction.fields.getTextInputValue('reason');
      return handleDecision(interaction, false, reason);
    }
  } catch (err) {
    console.error('Erreur interaction :', err);
    const msg = { content: '❌ Une erreur est survenue.', ephemeral: true };
    if (interaction.replied || interaction.deferred) interaction.followUp(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
});

client.login(TOKEN);
