import { Telegraf, Markup } from "telegraf";
import express from "express";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN não definido nas variáveis de ambiente");
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

const port = process.env.PORT || 10000;
const LEADS_FILE = "leads.json";
const PAYMENTS_FILE = "payments.json";
const STATE_FILE = "group_state.json";
const TRIGGER_HOUR = 20;
const TRIGGER_MINUTE = 0;
const TZ = "America/Sao_Paulo";

// ================= CONFIG VIP =================

const PIX_KEY = process.env.PIX_KEY || "17218127762";
const PIX_NAME = process.env.PIX_NAME || "Bia Negah";
const VIP_LINK = process.env.VIP_LINK || "https://t.me/+CPfphJ1olCAxY2M5";
const SUPPORT_USER = process.env.SUPPORT_USER || "@gerente_12";

const PLANS = {
  semanal: {
    label: "7 dias",
    price: "R$ 10,90",
  },
  quinzenal: {
    label: "15 dias",
    price: "R$ 16,90",
  },
  mensal: {
    label: "30 dias",
    price: "R$ 29,90",
  },
};

// ================= HELPERS JSON =================

function ensureJsonFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
  }
}

function readJson(file, defaultValue) {
  ensureJsonFile(file, defaultValue);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_error) {
    return defaultValue;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ================= LEADS =================

function getLeads() {
  return readJson(LEADS_FILE, []);
}

function saveLead(user) {
  const leads = getLeads();
  const exists = leads.find((l) => l.id === user.id);

  if (!exists) {
    leads.push({
      id: user.id,
      username: user.username || "",
      name: user.first_name || "",
      date: new Date().toISOString(),
    });

    writeJson(LEADS_FILE, leads);
    return true;
  }

  return false;
}

async function notifyNewLead(user) {
  if (!ADMIN_ID) return;

  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `🚨 Novo lead no VIP da Bia Negah\n\nNome: ${user.first_name || "Sem nome"}\n@${
        user.username || "sem username"
      }\nID: ${user.id}`
    );
  } catch (error) {
    console.log("Erro ao avisar admin:", error.message);
  }
}

// ================= PAGAMENTOS =================

function getPayments() {
  return readJson(PAYMENTS_FILE, []);
}

function savePayments(payments) {
  writeJson(PAYMENTS_FILE, payments);
}

function createPayment(user, planKey) {
  const payments = getPayments();
  const paymentId = `${Date.now()}_${user.id}`;
  const plan = PLANS[planKey] || PLANS.mensal;

  const payment = {
    id: paymentId,
    userId: user.id,
    username: user.username || "",
    name: user.first_name || "",
    planKey,
    planLabel: plan.label,
    price: plan.price,
    status: "aguardando_comprovante",
    createdAt: new Date().toISOString(),
  };

  payments.push(payment);
  savePayments(payments);
  return payment;
}

function findLatestPendingPaymentByUser(userId) {
  const payments = getPayments();
  return [...payments]
    .reverse()
    .find(
      (p) =>
        String(p.userId) === String(userId) &&
        ["aguardando_comprovante", "em_analise"].includes(p.status)
    );
}

function updatePaymentStatus(paymentId, status) {
  const payments = getPayments();
  const payment = payments.find((p) => p.id === paymentId);

  if (!payment) return null;

  payment.status = status;
  payment.updatedAt = new Date().toISOString();
  savePayments(payments);
  return payment;
}

// ================= ESTADO ANTIGO DO GRUPO =================

function getState() {
  const raw = readJson(STATE_FILE, { repliedUsersByDate: {} });

  if (!raw.repliedUsersByDate || typeof raw.repliedUsersByDate !== "object") {
    raw.repliedUsersByDate = {};
  }

  return raw;
}

function saveState(state) {
  writeJson(STATE_FILE, state);
}

function getSaoPauloParts() {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

function isAfterTime() {
  const now = getSaoPauloParts();
  const h = now.hour;
  const m = now.minute;

  if (h > TRIGGER_HOUR) return true;
  if (h === TRIGGER_HOUR && m >= TRIGGER_MINUTE) return true;

  return false;
}

function getToday() {
  const now = getSaoPauloParts();
  return `${now.year}-${now.month}-${now.day}`;
}

function hasUserReceivedReplyToday(state, userId) {
  const today = getToday();
  const users = state.repliedUsersByDate[today] || [];
  return users.includes(String(userId));
}

function markUserRepliedToday(state, userId) {
  const today = getToday();

  if (!Array.isArray(state.repliedUsersByDate[today])) {
    state.repliedUsersByDate[today] = [];
  }

  const userIdStr = String(userId);

  if (!state.repliedUsersByDate[today].includes(userIdStr)) {
    state.repliedUsersByDate[today].push(userIdStr);
  }

  Object.keys(state.repliedUsersByDate).forEach((date) => {
    if (date !== today) {
      delete state.repliedUsersByDate[date];
    }
  });
}

// ================= MENUS =================

async function showAgeGate(ctx) {
  await ctx.reply(
    "🔞 Bem-vindo ao VIP da Bia Negah.\n\nEste conteúdo é exclusivo para maiores de 18 anos.\n\nPara continuar, confirme que você tem 18 anos ou mais.",
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Confirmo que sou maior de 18 anos", "AGE_OK")],
    ])
  );
}

async function showMainMenu(ctx) {
  await ctx.reply(
    "🔥 VIP da Bia Negah\n\nEscolha uma opção abaixo:",
    Markup.inlineKeyboard([
      [Markup.button.callback("💎 Ver planos", "SHOW_PLANS")],
      [Markup.button.callback("📩 Enviar comprovante", "SEND_PROOF")],
      [Markup.button.callback("ℹ️ Como funciona", "HOW_IT_WORKS")],
      [Markup.button.callback("🆘 Suporte", "SUPPORT")],
    ])
  );
}

async function showPlans(ctx) {
  await ctx.reply(
    "💎 Planos disponíveis:\n\nEscolha o plano desejado para receber os dados do PIX.",
    Markup.inlineKeyboard([
      [Markup.button.callback(`🔥 7 dias — ${PLANS.semanal.price}`, "PLAN_semanal")],
      [Markup.button.callback(`💎 15 dias — ${PLANS.quinzenal.price}`, "PLAN_quinzenal")],
      [Markup.button.callback(`👑 30 dias — ${PLANS.mensal.price}`, "PLAN_mensal")],
      [Markup.button.callback("⬅️ Voltar", "BACK_MENU")],
    ])
  );
}

async function sendPixInstructions(ctx, planKey) {
  const payment = createPayment(ctx.from, planKey);

  await ctx.reply(
    `✅ Plano escolhido: ${payment.planLabel}\nValor: ${payment.price}\n\n💳 Pagamento via PIX\n\nChave PIX:\n${PIX_KEY}\n\nNome do recebedor:\n${PIX_NAME}\n\nDepois do pagamento, envie aqui o comprovante em imagem ou PDF.\n\nPedido: ${payment.id}`
  );
}

async function sendHowItWorks(ctx) {
  await ctx.reply(
    "ℹ️ Como funciona:\n\n1. Você escolhe um plano.\n2. Faz o PIX na chave informada.\n3. Envia o comprovante aqui no bot.\n4. A equipe confere o pagamento.\n5. Após aprovação, você recebe o acesso VIP."
  );
}

// ================= BOT =================

bot.start(async (ctx) => {
  const isNewLead = saveLead(ctx.from);

  if (isNewLead) {
    await notifyNewLead(ctx.from);
  }

  await showAgeGate(ctx);
});

bot.command("teste", async (ctx) => {
  await ctx.reply("✅ teste ok");
});

bot.action("AGE_OK", async (ctx) => {
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

bot.action("BACK_MENU", async (ctx) => {
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

bot.action("SHOW_PLANS", async (ctx) => {
  await ctx.answerCbQuery();
  await showPlans(ctx);
});

bot.action("HOW_IT_WORKS", async (ctx) => {
  await ctx.answerCbQuery();
  await sendHowItWorks(ctx);
});

bot.action("SUPPORT", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`🆘 Suporte: ${SUPPORT_USER}`);
});

bot.action("SEND_PROOF", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("📩 Envie o comprovante do PIX aqui no bot, em imagem ou PDF.");
});

bot.action(/^PLAN_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const planKey = ctx.match[1];
  await sendPixInstructions(ctx, planKey);
});

bot.action(/^APPROVE_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  if (String(ctx.from.id) !== String(ADMIN_ID)) {
    return ctx.reply("Ação permitida apenas para o admin.");
  }

  const paymentId = ctx.match[1];
  const payment = updatePaymentStatus(paymentId, "aprovado");

  if (!payment) {
    return ctx.reply("Pagamento não encontrado.");
  }

  await bot.telegram.sendMessage(
    payment.userId,
    `✅ Pagamento aprovado!\n\nSeu acesso ao VIP da Bia Negah foi liberado:\n${VIP_LINK}`
  );

  await ctx.reply(`✅ Acesso liberado para ${payment.name || payment.userId}`);
});

bot.action(/^REJECT_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  if (String(ctx.from.id) !== String(ADMIN_ID)) {
    return ctx.reply("Ação permitida apenas para o admin.");
  }

  const paymentId = ctx.match[1];
  const payment = updatePaymentStatus(paymentId, "recusado");

  if (!payment) {
    return ctx.reply("Pagamento não encontrado.");
  }

  await bot.telegram.sendMessage(
    payment.userId,
    "❌ Não conseguimos confirmar o pagamento.\n\nConfira o PIX e envie o comprovante novamente ou fale com o suporte."
  );

  await ctx.reply(`❌ Pagamento recusado para ${payment.name || payment.userId}`);
});

bot.on(["photo", "document"], async (ctx) => {
  try {
    if (ctx.chat?.type !== "private") return;

    const payment = findLatestPendingPaymentByUser(ctx.from.id);

    if (!payment) {
      return ctx.reply(
        "📩 Comprovante recebido, mas não encontrei um plano pendente.\n\nClique em 💎 Ver planos e escolha um plano antes de enviar o comprovante."
      );
    }

    updatePaymentStatus(payment.id, "em_analise");

    await ctx.reply("✅ Comprovante recebido. Aguarde a conferência da equipe.");

    if (ADMIN_ID) {
      const caption =
        `📩 Novo comprovante recebido\n\n` +
        `Cliente: ${ctx.from.first_name || "Sem nome"}\n` +
        `Username: @${ctx.from.username || "sem username"}\n` +
        `ID: ${ctx.from.id}\n` +
        `Plano: ${payment.planLabel}\n` +
        `Valor: ${payment.price}\n` +
        `Pedido: ${payment.id}`;

      if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await bot.telegram.sendPhoto(ADMIN_ID, photo, {
          caption,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("✅ Aprovar", `APPROVE_${payment.id}`)],
            [Markup.button.callback("❌ Recusar", `REJECT_${payment.id}`)],
          ]).reply_markup,
        });
      } else if (ctx.message.document) {
        await bot.telegram.sendDocument(ADMIN_ID, ctx.message.document.file_id, {
          caption,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("✅ Aprovar", `APPROVE_${payment.id}`)],
            [Markup.button.callback("❌ Recusar", `REJECT_${payment.id}`)],
          ]).reply_markup,
        });
      }
    }
  } catch (error) {
    console.log("Erro ao processar comprovante:", error.message);
    await ctx.reply("Erro ao receber comprovante. Tente enviar novamente.");
  }
});

bot.on("message", async (ctx, next) => {
  try {
    console.log("Mensagem recebida");
    console.log("chat.type:", ctx.chat?.type);
    console.log("chat.id:", ctx.chat?.id);
    console.log("from.id:", ctx.from?.id);
    console.log("texto:", ctx.message?.text || "[sem texto]");

    const text = (ctx.message?.text || "").trim().toLowerCase();

    if (ctx.chat?.type === "private") {
      if (["/start", "start", "oi", "olá", "ola", "menu"].includes(text)) {
        const isNewLead = saveLead(ctx.from);

        if (isNewLead) {
          await notifyNewLead(ctx.from);
        }

        return showAgeGate(ctx);
      }

      return ctx.reply(
        "Escolha uma opção no menu ou envie /start para começar."
      );
    }

    if (!ctx.from || ctx.from.is_bot) return next();

    if (text.startsWith("/")) return next();

    if (!isAfterTime()) {
      console.log("Ainda não passou das 20h em SP");
      return next();
    }

    const state = getState();

    if (hasUserReceivedReplyToday(state, ctx.from.id)) {
      console.log("Usuário já recebeu resposta hoje:", ctx.from.id);
      return next();
    }

    await ctx.reply("Ok");

    markUserRepliedToday(state, ctx.from.id);
    saveState(state);

    console.log("✅ Respondeu OK para o usuário:", ctx.from.id);
  } catch (err) {
    console.log("Erro:", err.message);
  }

  return next();
});

// ================= SERVIDOR / WEBHOOK =================

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Bot online");
});

const WEBHOOK_PATH = `/webhook/${BOT_TOKEN}`;

app.post(WEBHOOK_PATH, async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.log("Erro no webhook:", error.message);
    res.sendStatus(500);
  }
});

app.listen(port, async () => {
  console.log(`Servidor rodando na porta ${port}`);

  try {
    const renderUrl = process.env.RENDER_EXTERNAL_URL;

    if (!renderUrl) {
      throw new Error("RENDER_EXTERNAL_URL não definida");
    }

    const WEBHOOK_URL = `${renderUrl}${WEBHOOK_PATH}`;

    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log("✅ Webhook configurado:", WEBHOOK_URL);
  } catch (e) {
    console.log("Erro ao iniciar bot:", e.message);
  }
});
