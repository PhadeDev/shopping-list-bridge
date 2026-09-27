const state = { items: [], busy: false };
const form = document.querySelector("#add-form");
const nameInput = document.querySelector("#item-name");
const quantityInput = document.querySelector("#item-quantity");
const message = document.querySelector("#form-message");
const activeList = document.querySelector("#active-list");
const completedList = document.querySelector("#completed-list");
const activeCount = document.querySelector("#active-count");
const completedCount = document.querySelector("#completed-count");
const template = document.querySelector("#item-template");

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function loadItems() {
  try {
    const body = await api("/api/items?status=all");
    state.items = body.items;
    render();
  } catch (error) {
    activeList.innerHTML = `<div class="empty-state error-state">Could not reach the shopping list.<br>${escapeHtml(error.message)}</div>`;
  }
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function render() {
  const active = state.items.filter((item) => !item.completed);
  const completed = state.items.filter((item) => item.completed);
  activeCount.textContent = active.length;
  completedCount.textContent = completed.length;
  renderList(activeList, active, false);
  renderList(completedList, completed, true);
}

function renderList(container, items, completed) {
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = completed ? "Nothing picked up yet." : "Nothing needed. Lovely.";
    container.append(empty);
    return;
  }

  items.forEach((item) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;
    card.querySelector(".item-name").textContent = item.name;
    const check = card.querySelector(".check-button");
    check.setAttribute("aria-label", completed ? `Move ${item.name} back to active list` : `Mark ${item.name} complete`);
    check.addEventListener("click", () => patchItem(item.id, { completed: !completed }));

    const qty = card.querySelector(".quantity-edit input");
    qty.value = item.quantity;
    qty.addEventListener("change", () => {
      const value = Number.parseInt(qty.value, 10);
      if (value >= 1 && value <= 999 && value !== item.quantity) patchItem(item.id, { quantity: value });
      else qty.value = item.quantity;
    });

    card.querySelector(".delete-button").addEventListener("click", async () => {
      if (!window.confirm(`Delete “${item.name}”?`)) return;
      await mutate(() => api(`/api/items/${item.id}`, { method: "DELETE" }));
    });
    container.append(card);
  });
}

async function patchItem(id, changes) {
  await mutate(() => api(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(changes) }));
}

async function mutate(operation) {
  if (state.busy) return;
  state.busy = true;
  try {
    await operation();
    await loadItems();
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.busy = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const quantity = Number.parseInt(quantityInput.value, 10) || 1;
  if (!name || state.busy) return;

  message.textContent = "";
  state.busy = true;
  try {
    const body = await api("/api/items", {
      method: "POST",
      body: JSON.stringify({ name, quantity }),
    });
    message.className = "form-message success";
    message.textContent = body.merged ? `Added ${quantity} more to ${body.item.name}.` : `${body.item.name} added.`;
    form.reset();
    quantityInput.value = 1;
    nameInput.focus({ preventScroll: true });
    await loadItems();
  } catch (error) {
    message.className = "form-message";
    message.textContent = error.message;
  } finally {
    state.busy = false;
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadItems();
});
window.addEventListener("focus", loadItems);
loadItems();
setInterval(loadItems, 30000);
