import { ApifyClient } from "apify-client";
import { google } from "googleapis";
import express from "express";
import fs from "fs";
import "dotenv/config";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
const port = 80;

app.use(bodyParser.json({ limit: "50mb" }));

const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

const credentials = JSON.parse(fs.readFileSync("credentials.json", "utf8"));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

app.post("/parse", (req, res) => {
  try {
    const username = req.body["username"];
    const resultsLimit = req.body["resultsLimit"] || 200;
    const clientId = req.body["clientId"];

    const actorInput = {
      username: [username],
      resultsLimit: resultsLimit,
    };

    console.log(`Старт парсинга аккауна @${username} для ${clientId}`);

    client
      .actor("apify/instagram-reel-scraper")
      .call(actorInput)
      .then((run) => {
        console.log(
          `💾 Датасет @${username} для ${clientId}: https://console.apify.com/storage/datasets/${run.defaultDatasetId}`
        );

        return client.dataset(run.defaultDatasetId).listItems();
      })
      .then((dataset) => {
        const { items } = dataset;

        return createGoogleSheet(username, items);
      })
      .then((sheetUrl) => {
        axios.post(
          `https://chatter.salebot.pro/api/${process.env.SALEBOT_API_KEY}/callback`,
          {
            client_id: clientId,
            message: "parsing_success",
            sheetUrl: sheetUrl,
          }
        );
      })
      .catch((e) => {
        // console.log(e);
        axios.post(
          `https://chatter.salebot.pro/api/${process.env.SALEBOT_API_KEY}/callback`,
          {
            client_id: clientId,
            message: "parsing_error",
          }
        );
      });

    res.sendStatus(200);
  } catch (e) {
    const clientId = req.body["clientId"];

    axios.post(
      `https://chatter.salebot.pro/api/${process.env.SALEBOT_API_KEY}/callback`,
      {
        client_id: clientId,
        message: "server_error",
      }
    );

    res.sendStatus(401);
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

async function createGoogleSheet(username, items) {
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  // Создание новой таблицы
  const response = await sheets.spreadsheets.create({
    resource: {
      properties: {
        title: `Топ рилсов @${username}`,
      },
    },
  });

  const spreadsheetId = response.data.spreadsheetId;
  console.log("Таблица создана! ID:", spreadsheetId);

  // Делаем таблицу доступной всем
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      role: "reader", // Только просмотр
      type: "anyone", // Для всех
    },
  });

  const sheetUrl = response.data.spreadsheetUrl;
  console.log("Ссылка:", sheetUrl);

  const labels = ["№", "Ссылка", "Просмотры", "Лайки", "Комментарии"];

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: "A1",
    valueInputOption: "RAW",
    resource: {
      values: [
        labels,
        ...items
          .sort((a, b) => b.videoViewCount - a.videoViewCount)
          .map((el, i) => [
            i + 1,
            el.url,
            el.videoViewCount,
            el.likesCount,
            el.commentsCount,
          ]),
      ],
    },
  });

  console.log("Данные добавлены!");

  return sheetUrl;
}
