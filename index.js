require("dotenv").config({ override: true });
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const axios = require("axios");

const PREFIX = "!";
const DEFAULT_CITY = process.env.PRAYER_CITY || "Jakarta";
const DEFAULT_COUNTRY = process.env.PRAYER_COUNTRY || "Indonesia";
const PRAYER_METHOD = Number(process.env.PRAYER_METHOD || 20);
const ADZAN_CHANNEL_ID = process.env.ADZAN_CHANNEL_ID;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_DEFAULT_ENABLED = process.env.AI_DEFAULT_ENABLED === "true";

async function getPrayerTimes(city, country) {
  const targetCity = city || DEFAULT_CITY;
  const targetCountry = country || DEFAULT_COUNTRY;
  const url = "https://api.aladhan.com/v1/timingsByCity";
  const response = await axios.get(url, {
    params: {
      city: targetCity,
      country: targetCountry,
      method: PRAYER_METHOD
    }
  });
  if (!response.data || response.data.code !== 200) {
    throw new Error("Gagal mengambil data jadwal sholat");
  }
  const timings = response.data.data.timings;
  return {
    imsak: timings.Imsak,
    fajr: timings.Fajr,
    dhuhr: timings.Dhuhr,
    asr: timings.Asr,
    maghrib: timings.Maghrib,
    isha: timings.Isha
  };
}

async function getHijriDateInfo() {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const url = `https://api.aladhan.com/v1/gToH/${day}-${month}-${year}`;
  const response = await axios.get(url);
  if (!response.data || response.data.code !== 200) {
    throw new Error("Gagal mengambil informasi tanggal Hijriah");
  }
  const hijri = response.data.data.hijri;
  const isRamadan = hijri.month.number === 9;
  return {
    day: hijri.day,
    monthNumber: hijri.month.number,
    monthName: hijri.month.en,
    year: hijri.year,
    isRamadan
  };
}

function parseTimeToTodayDate(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  const now = new Date();
  const date = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0
  );
  return date;
}

async function sendAdzanNotification(client, prayerKey, prayerLabel, time) {
  if (!ADZAN_CHANNEL_ID) {
    console.error("ADZAN_CHANNEL_ID belum di-set di environment.");
    return;
  }
  try {
    const channel = await client.channels.fetch(ADZAN_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error("Channel untuk notifikasi adzan tidak valid.");
      return;
    }
    const title =
      prayerKey === "maghrib"
        ? "Waktu Maghrib / Buka Puasa"
        : `Waktu ${prayerLabel}`;
    const description =
      prayerKey === "maghrib"
        ? `Sudah masuk waktu Maghrib yang juga menjadi waktu berbuka puasa untuk ${DEFAULT_CITY}, ${DEFAULT_COUNTRY}.`
        : `Sudah masuk waktu ${prayerLabel} untuk ${DEFAULT_CITY}, ${DEFAULT_COUNTRY}.`;
    const colorMap = {
      imsak: 0x0891b2,
      fajr: 0x1d4ed8,
      dhuhr: 0xfacc15,
      asr: 0xf97316,
      maghrib: 0xef4444,
      isha: 0x4c1d95,
      test: 0x6b7280
    };
    const color = colorMap[prayerKey] || 0x10b981;
    const accent =
      prayerKey === "maghrib"
        ? "🌅"
        : prayerKey === "imsak"
        ? "🌙"
        : "🕌";
    const mention =
      prayerKey === "test"
        ? ""
        : "@everyone ";
    const embed = new EmbedBuilder()
      .setTitle(`${accent} ${title}`)
      .setDescription(description)
      .setColor(color)
      .addFields(
        { name: "Jam", value: time, inline: true },
        { name: "Kota", value: DEFAULT_CITY, inline: true },
        { name: "Negara", value: DEFAULT_COUNTRY, inline: true }
      )
      .setFooter({ text: "Jadwal Sholat Otomatis • WIB" })
      .setTimestamp(new Date());
    await channel.send(
      mention
        ? { content: mention, embeds: [embed] }
        : { embeds: [embed] }
    );
  } catch (error) {
    console.error("Gagal mengirim notifikasi adzan.", prayerKey, error);
  }
}

async function scheduleDailyAdzanNotifications(client) {
  try {
    const times = await getPrayerTimes();
    const now = new Date();
    const prayers = [
      { key: "imsak", label: "Imsak", time: times.imsak },
      { key: "fajr", label: "Subuh", time: times.fajr },
      { key: "dhuhr", label: "Dzuhur", time: times.dhuhr },
      { key: "asr", label: "Ashar", time: times.asr },
      { key: "maghrib", label: "Maghrib", time: times.maghrib },
      { key: "isha", label: "Isya", time: times.isha }
    ];
    for (const prayer of prayers) {
      const targetDate = parseTimeToTodayDate(prayer.time);
      const diff = targetDate.getTime() - now.getTime();
      if (diff > 0) {
        console.log(
          `Menjadwalkan notifikasi ${prayer.label} pada ${prayer.time} untuk hari ini.`
        );
        setTimeout(() => {
          sendAdzanNotification(
            client,
            prayer.key,
            prayer.label,
            prayer.time
          );
        }, diff);
      } else {
        console.log(
          `Waktu ${prayer.label} (${prayer.time}) untuk hari ini sudah lewat, tidak dijadwalkan.`
        );
      }
    }
  } catch (error) {
    console.error("Gagal menjadwalkan notifikasi adzan harian.", error);
  }
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    5,
    0
  );
  const msUntilNextMidnight = nextMidnight.getTime() - now.getTime();
  setTimeout(() => {
    scheduleDailyAdzanNotifications(client);
  }, msUntilNextMidnight);
}

let aiEnabled = AI_DEFAULT_ENABLED;

async function callAiChat(prompt) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY belum di-set di environment.");
  }
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model: "deepseek/deepseek-r1-0528:free",
    messages: [
      {
        role: "system",
        content:
          "Kamu adalah asisten chat yang sopan dan ramah, menjawab dalam bahasa Indonesia, singkat, jelas, dan terasa seperti manusia."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };
  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    timeout: 20000
  });
  if (
    !response.data ||
    !response.data.choices ||
    !response.data.choices[0] ||
    !response.data.choices[0].message
  ) {
    throw new Error("Respons AI tidak valid.");
  }
  return response.data.choices[0].message.content;
}

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
  });
  return client;
}

function registerHandlers(client) {
  client.on("clientReady", () => {
    console.log(`Bot login sebagai ${client.user.tag}`);
    scheduleDailyAdzanNotifications(client);
  });

  client.on("messageCreate", async message => {
    if (message.author.bot) {
      return;
    }
    if (message.content.startsWith(PREFIX)) {
      const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const command = args.shift().toLowerCase();

      if (command === "aion") {
        aiEnabled = true;
        await message.reply(
          "Mode AI telah diaktifkan. Sekarang kamu bisa chat langsung tanpa !ai."
        );
        return;
      }

      if (command === "aioff") {
        aiEnabled = false;
        await message.reply("Mode AI telah dimatikan.");
        return;
      }

      if (command === "ai") {
        if (!aiEnabled) {
          await message.reply(
            "Mode AI sedang nonaktif. Aktifkan dengan perintah !aion."
          );
          return;
        }
        const promptFromCommand = args.join(" ");
        if (!promptFromCommand) {
          await message.reply(
            "Tulis pertanyaan setelah perintah, contoh: !ai Apa kabar?"
          );
          return;
        }
        try {
          const replyText = await callAiChat(promptFromCommand);
          await message.reply(replyText);
        } catch (error) {
          console.error("Gagal memanggil API AI:", error);
          await message.reply("Maaf, terjadi kendala saat memproses jawaban AI.");
        }
        return;
      }

      if (command === "imsak") {
        try {
          const city = args[0];
          const country = args[1];
          const times = await getPrayerTimes(city, country);
          await message.reply(
            `Informasi Imsak dan Subuh\n` +
              `Imsak: ${times.imsak}\n` +
              `Subuh (Fajr): ${times.fajr}`
          );
        } catch (error) {
          await message.reply(
            "Terjadi kesalahan saat mengambil informasi imsak. Coba lagi nanti."
          );
        }
        return;
      }

      if (command === "adzan") {
        try {
          const city = args[0];
          const country = args[1];
          const times = await getPrayerTimes(city, country);
          const teks =
            `Jadwal Sholat untuk ${city || DEFAULT_CITY}, ${
              country || DEFAULT_COUNTRY
            }\n` +
            `Imsak: ${times.imsak}\n` +
            `Subuh (Fajr): ${times.fajr}\n` +
            `Dzuhur (Dhuhr): ${times.dhuhr}\n` +
            `Ashar (Asr): ${times.asr}\n` +
            `Maghrib: ${times.maghrib}\n` +
            `Isya (Isha): ${times.isha}`;
          await message.reply(teks);
        } catch (error) {
          await message.reply(
            "Terjadi kesalahan saat mengambil informasi adzan. Coba lagi nanti."
          );
        }
        return;
      }

      if (command === "puasa") {
        try {
          const info = await getHijriDateInfo();
          const status = info.isRamadan
            ? "Sekarang berada di bulan Ramadhan, disunnahkan dan diwajibkan puasa sesuai ketentuan."
            : "Saat ini bukan bulan Ramadhan. Tetap bisa melakukan puasa sunnah sesuai hari-hari yang dianjurkan.";
          const teks =
            `Informasi Tanggal Hijriah:\n` +
            `${info.day} ${info.monthName} ${info.year} H\n` +
            status;
          await message.reply(teks);
        } catch (error) {
          await message.reply(
            "Terjadi kesalahan saat mengambil informasi puasa. Coba lagi nanti."
          );
        }
        return;
      }

      if (command === "testadzan") {
        const label = args.join(" ") || "Adzan (Tes)";
        const now = new Date();
        const timeString = `${String(now.getHours()).padStart(
          2,
          "0"
        )}:${String(now.getMinutes()).padStart(2, "0")}`;
        await sendAdzanNotification(client, "test", label, timeString);
        await message.reply("Notifikasi adzan tes telah dikirim.");
        return;
      }

      if (command === "tagall") {
        const pesanTambahan = args.join(" ");
        const konten =
          "@everyone " +
          (pesanTambahan || "panggilan untuk semua member di server ini.");
        await message.channel.send({ content: konten });
        return;
      }

      if (command === "pushall") {
        if (!message.guild) {
          await message.reply(
            "Perintah ini hanya bisa digunakan di dalam server (guild)."
          );
          return;
        }
        const teks = args.join(" ");
        if (!teks) {
          await message.reply(
            "Silakan tambahkan pesan, contoh: !pushall Assalamualaikum semuanya."
          );
          return;
        }
        await message.reply(
          "Mengirim pesan ke semua member yang memungkinkan DM. Ini bisa memakan waktu dan terbatasi oleh rate limit Discord."
        );
        try {
          const members = await message.guild.members.fetch();
          const promises = [];
          for (const member of members.values()) {
            if (member.user.bot) {
              continue;
            }
            promises.push(member.send(teks).catch(() => undefined));
          }
          await Promise.all(promises);
          await message.followUp
            ? message.followUp("Selesai mengirim pesan ke member.")
            : message.channel.send("Selesai mengirim pesan ke member.");
        } catch (error) {
          await message.channel.send(
            "Terjadi kesalahan saat mengirim pesan ke member."
          );
        }
        return;
      }

      return;
    }

    if (aiEnabled) {
      const prompt = message.content.trim();
      if (!prompt) {
        return;
      }
      try {
        const replyText = await callAiChat(prompt);
        await message.reply(replyText);
      } catch (error) {
        console.error("Gagal memanggil API AI:", error);
      }
    }
  });
}

function start() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("DISCORD_TOKEN belum di-set di environment.");
    process.exit(1);
  }
  const client = createClient();
  registerHandlers(client);
  console.log("DISCORD_TOKEN length:", token.length);
  client.login(token).catch(error => {
    console.error(
      "Gagal login ke Discord. Periksa kembali token bot di .env.",
      error
    );
    process.exit(1);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  createClient,
  registerHandlers,
  getPrayerTimes,
  getHijriDateInfo,
  start
};
