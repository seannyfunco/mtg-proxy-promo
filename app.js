const SCRYFALL_BASE_URL = "https://api.scryfall.com";
const MIN_RARES_PER_SET = 3;
const RECENT_YEARS_LIMIT = 2;
const SET_ELIGIBILITY_CONCURRENCY = 8;
const FETCH_RETRY_LIMIT = 3;
const ELIGIBLE_SET_TYPES = new Set([
  "core",
  "expansion",
  "masters",
  "draft_innovation",
  "commander",
  "box",
  "starter",
  "funny",
  "duel_deck",
  "premium_deck",
  "from_the_vault",
  "spellbook",
  "archenemy",
  "planechase",
  "vanguard"
]);

const setSelect = document.getElementById("set-select");
const statusBox = document.getElementById("status");
const cardList = document.getElementById("card-list");
const finalCard = document.getElementById("final-card");
const progressContainer = document.getElementById("progress-container");
const setProgress = document.getElementById("set-progress");
const progressText = document.getElementById("progress-text");
const includeCommanderCheckbox = document.getElementById("include-commander");
const form = document.getElementById("randomizer-form");
const generateButton = document.getElementById("generate-button");

function isWithinRecentYears(releaseDate, yearsBack = RECENT_YEARS_LIMIT) {
  if (!releaseDate) return false;
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setFullYear(now.getFullYear() - yearsBack);
  return new Date(releaseDate) >= cutoff;
}

async function fetchSets({ includeCommander = false } = {}) {
  const { payload } = await fetchJsonWithRetry(`${SCRYFALL_BASE_URL}/sets`, {
    retries: FETCH_RETRY_LIMIT,
    errorMessage: "Could not load set list from Scryfall."
  });

  return payload.data
    .filter((set) => {
      if (set.digital || set.card_count < MIN_RARES_PER_SET) return false;
      if (!ELIGIBLE_SET_TYPES.has(set.set_type)) return false;
      if (!isWithinRecentYears(set.released_at)) return false;
      if (!includeCommander && set.set_type === "commander") return false;
      return true;
    })
    .sort((a, b) => new Date(b.released_at) - new Date(a.released_at));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(
  url,
  {
    retries = 2,
    errorMessage = "Request failed.",
    retryOnStatus = new Set([429, 500, 502, 503, 504]),
    allow404 = false
  } = {}
) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (allow404 && response.status === 404) return { status: 404, payload: null };

      if (!response.ok) {
        if (!retryOnStatus.has(response.status)) {
          const nonRetryableError = new Error(errorMessage);
          nonRetryableError.nonRetryable = true;
          nonRetryableError.httpStatus = response.status;
          throw nonRetryableError;
        }

        throw new Error(`retryable-status-${response.status}`);
      }

      return { status: response.status, payload: await response.json() };
    } catch (error) {
      lastError = error;
      if (error?.nonRetryable || attempt === retries) break;
      await delay(250 * (attempt + 1));
    }
  }

  if (lastError?.nonRetryable) {
    throw new Error(`${errorMessage} (HTTP ${lastError.httpStatus})`);
  }

  if (lastError?.message?.startsWith("retryable-status-")) {
    throw new Error(errorMessage);
  }

  throw new Error(`${errorMessage} Please check your connection and try again.`);
}

async function countPaperRaresInSet(setCode) {
  const query = encodeURIComponent(`set:${setCode} rarity:rare game:paper`);
  const result = await fetchJsonWithRetry(
    `${SCRYFALL_BASE_URL}/cards/search?q=${query}&unique=cards&page=1`,
    {
      retries: FETCH_RETRY_LIMIT,
      errorMessage: "Could not validate set rare counts.",
      allow404: true
    }
  );

  if (result.status === 404) {
    return 0;
  }

  const { payload } = result;
  return payload.total_cards ?? 0;
}

async function filterEligibleSets(sets) {
  const eligibleSets = [];
  const failedSetCodes = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= sets.length) return;

      const set = sets[index];

      try {
        const rareCount = await countPaperRaresInSet(set.code);
        if (rareCount >= MIN_RARES_PER_SET) {
          eligibleSets.push(set);
        }
      } catch (error) {
        failedSetCodes.push(set.code);
        console.warn(`Eligibility check failed for set ${set.code}:`, error);
      } finally {
        completed += 1;
        showStatus(`Checking set eligibility ${completed}/${sets.length}…`);
        showProgress(completed, sets.length, `Validating set ${completed} of ${sets.length}…`);
      }
    }
  }

  const workerCount = Math.min(SET_ELIGIBILITY_CONCURRENCY, sets.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  const setOrder = new Map(sets.map((set, index) => [set.code, index]));
  eligibleSets.sort((a, b) => setOrder.get(a.code) - setOrder.get(b.code));
  return { eligibleSets, failedSetCount: failedSetCodes.length };
}

function buildSetOptions(sets) {
  setSelect.innerHTML = `<option value="">Choose a set</option>`;

  sets.forEach((set) => {
    const option = document.createElement("option");
    option.value = set.code;
    option.textContent = `${set.name} (${set.code.toUpperCase()})`;
    setSelect.append(option);
  });
}

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.style.color = isError ? "#ff9da2" : "#98f0cf";
}

function showProgress(current, total, message = "") {
  progressContainer.classList.remove("hidden");
  const safeTotal = Math.max(total, 1);
  setProgress.max = safeTotal;
  setProgress.value = Math.min(current, safeTotal);
  progressText.textContent = message || `Validated ${current} of ${total} sets.`;
}

function hideProgress() {
  progressContainer.classList.add("hidden");
}

function getCardImage(card) {
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return "";
}

function buildInfoLine(label, value) {
  const paragraph = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  paragraph.append(strong, value);
  return paragraph;
}

function renderCandidateCards(cards) {
  cardList.innerHTML = "";

  cards.forEach((card) => {
    const wrapper = document.createElement("article");
    wrapper.className = "card";

    const imageUrl = getCardImage(card);
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = card.name;
      image.loading = "lazy";
      wrapper.append(image);
    }

    const title = document.createElement("h3");
    title.textContent = card.name;
    wrapper.append(title);

    wrapper.append(
      buildInfoLine("Set", `${card.set_name} (${card.set.toUpperCase()})`),
      buildInfoLine("Rarity", card.rarity),
      buildInfoLine("Mana Cost", card.mana_cost || "N/A")
    );

    cardList.append(wrapper);
  });
}

function renderFinalAssignment(card) {
  finalCard.classList.remove("empty");
  finalCard.innerHTML = "";

  finalCard.append(buildInfoLine("Assigned Card", card.name));

  const scryfallLine = document.createElement("p");
  const label = document.createElement("strong");
  label.textContent = "Scryfall: ";

  const link = document.createElement("a");
  link.href = card.scryfall_uri;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.textContent = "View card details";

  scryfallLine.append(label, link);
  finalCard.append(scryfallLine);
}

async function fetchRandomRareFromSet(setCode) {
  const query = encodeURIComponent(`set:${setCode} rarity:rare game:paper unique:cards`);
  const { payload } = await fetchJsonWithRetry(`${SCRYFALL_BASE_URL}/cards/random?q=${query}`, {
    retries: FETCH_RETRY_LIMIT,
    errorMessage: "Failed to fetch random rare card."
  });
  return payload;
}

async function getThreeUniqueRares(setCode) {
  const cards = [];
  const seenOracleIds = new Set();
  const maxAttempts = 20;
  let attempts = 0;

  while (cards.length < 3 && attempts < maxAttempts) {
    attempts += 1;
    const card = await fetchRandomRareFromSet(setCode);
    const dedupeId = card.oracle_id || `${card.name}-${card.set}`;

    if (seenOracleIds.has(dedupeId)) {
      continue;
    }

    seenOracleIds.add(dedupeId);
    cards.push(card);
  }

  if (cards.length < 3) {
    throw new Error("Could not find 3 unique rares for that set. Try another set.");
  }

  return cards;
}

function chooseRandomCard(cards) {
  const index = Math.floor(Math.random() * cards.length);
  return cards[index];
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const setCode = setSelect.value;

  if (!setCode) {
    showStatus("Please choose a set.", true);
    return;
  }

  generateButton.disabled = true;
  cardList.innerHTML = "";
  finalCard.classList.add("empty");
  finalCard.textContent = "No card assigned yet.";
  showStatus("Generating random rares…");

  try {
    const candidates = await getThreeUniqueRares(setCode);
    renderCandidateCards(candidates);

    const assignedCard = chooseRandomCard(candidates);
    renderFinalAssignment(assignedCard);
    showStatus(`Assigned ${assignedCard.name}.`);
  } catch (error) {
    showStatus(error.message || "Unexpected error while generating cards.", true);
  } finally {
    generateButton.disabled = false;
  }
});

async function loadEligibleSets() {
  const includeCommander = includeCommanderCheckbox.checked;
  showStatus("Loading set list…");
  showProgress(0, 100, "Loading candidate sets…");
  setSelect.innerHTML = `<option value="">Loading sets…</option>`;

  try {
    const candidateSets = await fetchSets({ includeCommander });
    showProgress(0, candidateSets.length, "Validating sets for rare availability…");
    const { eligibleSets, failedSetCount } = await filterEligibleSets(candidateSets);

    if (failedSetCount > 0) {
      showStatus(
        `Validated with warnings: ${failedSetCount} set checks failed. Showing available validated sets.`,
        true
      );
    }

    if (eligibleSets.length === 0 && candidateSets.length > 0) {
      buildSetOptions(candidateSets);
      hideProgress();
      showStatus(
        "Set validation service is unavailable. Showing recent sets without rare-count validation.",
        true
      );
      return;
    }

    if (eligibleSets.length === 0) {
      throw new Error("No eligible sets found with at least three paper rares.");
    }

    buildSetOptions(eligibleSets);
    hideProgress();
    if (failedSetCount === 0) {
      showStatus("Ready!");
    }
  } catch (error) {
    setSelect.innerHTML = `<option value="">Could not load sets</option>`;
    hideProgress();
    showStatus(error.message || "Failed to initialize app.", true);
  }
}

includeCommanderCheckbox.addEventListener("change", () => {
  loadEligibleSets();
});

loadEligibleSets();
