// Player count status bot.
// Polls the GetOnlinePlayerCount CloudScript function (added to combined.js)
// via PlayFab's server-side ExecuteCloudScript API, then sets the bot's
// Discord presence to something like "Watching 42 players".
//
// It also polls GetRoomsSnapshot on a separate timer and posts a fresh
// embed to a Discord webhook showing the total online count plus who's
// in each currently-active room.

require("dotenv").config();
const { Client, GatewayIntentBits, ActivityType } = require("discord.js");

const {
    DISCORD_BOT_TOKEN,
    PLAYFAB_TITLE_ID,
    PLAYFAB_SECRET_KEY,
    UPDATE_INTERVAL_SECONDS = "60",
    ROOM_WEBHOOK_URL = "https://discord.com/api/webhooks/1546194665009717408/HxK914pupP5MMmzzVEiAq2bWXy6ZpnJLzeJtuy9PRk6h08hk3GU5uaR2pJps8l04afw5",
    ROOM_WEBHOOK_INTERVAL_MINUTES = "5",
} = process.env;

if (!DISCORD_BOT_TOKEN || !PLAYFAB_TITLE_ID || !PLAYFAB_SECRET_KEY) {
    console.error(
        "Missing required env vars. Set DISCORD_BOT_TOKEN, PLAYFAB_TITLE_ID, and PLAYFAB_SECRET_KEY in .env"
    );
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function callCloudScript(functionName) {
    const url = `https://${PLAYFAB_TITLE_ID}.playfabapi.com/Server/ExecuteCloudScript`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-SecretKey": PLAYFAB_SECRET_KEY,
        },
        body: JSON.stringify({
            FunctionName: functionName,
            FunctionParameter: {},
        }),
    });

    if (!res.ok) {
        throw new Error(`PlayFab request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const result = data?.data?.FunctionResult;

    if (!result) {
        throw new Error(`Unexpected CloudScript response: ${JSON.stringify(data)}`);
    }

    return result;
}

async function getOnlinePlayerCount() {
    const result = await callCloudScript("GetOnlinePlayerCount");
    if (typeof result.OnlinePlayerCount !== "number") {
        throw new Error(`Unexpected GetOnlinePlayerCount response: ${JSON.stringify(result)}`);
    }
    return result.OnlinePlayerCount;
}

async function updatePresence() {
    try {
        const count = await getOnlinePlayerCount();
        client.user.setActivity(`${count} player${count === 1 ? "" : "s"}`, {
            type: ActivityType.Watching,
        });
        console.log(`[${new Date().toISOString()}] Updated status: Watching ${count} players`);
    } catch (err) {
        console.error("Failed to update player count status:", err.message);
    }
}

async function postRoomsSnapshot() {
    try {
        const result = await callCloudScript("GetRoomsSnapshot");
        const rooms = result.Rooms || [];

        const fields = rooms.length
            ? rooms.slice(0, 25).map((room) => ({
                  name: `${room.GameId} (${room.Region})`,
                  value: room.Players.length ? room.Players.join("\n") : "_empty_",
                  inline: true,
              }))
            : [{ name: "No active rooms", value: "Nobody is currently in a room.", inline: false }];

        const embed = {
            title: "Live Player Count",
            description: `**Total Online:** ${result.OnlinePlayerCount}`,
            color: 3066993,
            fields,
            timestamp: new Date().toISOString(),
        };

        const res = await fetch(ROOM_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] }),
        });

        if (!res.ok) {
            throw new Error(`Webhook post failed: ${res.status} ${res.statusText}`);
        }

        console.log(`[${new Date().toISOString()}] Posted rooms snapshot (${rooms.length} rooms)`);
    } catch (err) {
        console.error("Failed to post rooms snapshot:", err.message);
    }
}

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    updatePresence();
    setInterval(updatePresence, Number(UPDATE_INTERVAL_SECONDS) * 1000);

    postRoomsSnapshot();
    setInterval(postRoomsSnapshot, Number(ROOM_WEBHOOK_INTERVAL_MINUTES) * 60 * 1000);
});

client.login(DISCORD_BOT_TOKEN);

