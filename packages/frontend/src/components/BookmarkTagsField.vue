<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  MAX_TAGS_PER_BOOKMARK,
  TAG_NAME_MAX,
  hasAnyTag,
  normalizeTagName,
} from "../data/bookmarks";

// The words one bookmark is filed under, written where the bookmark is: the
// chips it wears, each taken back off in one click, and one field that both
// reads the notebook's own words down to what is typed and makes a word the
// notebook does not hold yet. The same control in the save form and in the popup
// a saved row opens, so filing an entry is one thing to learn wherever it is
// done, and neither place is a screen of its own.
const props = defineProps<{
  tags: readonly string[];
  known: readonly string[];
  autofocus?: boolean;
}>();

const emit = defineEmits<{ add: [string]; remove: [string] }>();

const { t } = useI18n();
const draft = ref("");
const fieldEl = ref<HTMLInputElement | null>(null);

const full = computed(() => props.tags.length >= MAX_TAGS_PER_BOOKMARK);

// What the field offers: the notebook's own words, less the ones this bookmark
// already wears, read down to what is typed. Nothing at the cap, where the next
// word would be refused anyway, so the list stops offering itself rather than
// answering with a refusal.
const choices = computed(() => {
  if (full.value) return [];
  const needle = draft.value.trim().toLocaleLowerCase();
  return props.known.filter(
    (name) => !hasAnyTag(props.tags, name) && name.toLocaleLowerCase().includes(needle),
  );
});

const canAdd = computed(() => !full.value && normalizeTagName(draft.value) !== null);

function add(name: string): void {
  emit("add", name);
  draft.value = "";
  fieldEl.value?.focus();
}

// What the field holds becomes a chip: the word the notebook already knows where
// it names one, since `addTag` reads it back to the spelling in use, and a new
// word where it does not, which is the only way a tag comes into being.
function submit(): void {
  const name = normalizeTagName(draft.value);
  if (name === null || full.value || hasAnyTag(props.tags, name)) return;
  add(name);
}

onMounted(() => {
  if (props.autofocus) void nextTick(() => fieldEl.value?.focus());
});
</script>

<template>
  <div class="tags-field">
    <div class="worn">
      <span class="label">{{ t("bookmarks.tags") }}</span>
      <span v-for="name in tags" :key="name" class="chip">
        <span class="chip-name">{{ name }}</span>
        <button
          type="button"
          class="chip-drop"
          :aria-label="t('bookmarks.tagDrop', { name })"
          :title="t('bookmarks.tagDrop', { name })"
          @click="emit('remove', name)"
        >
          ×
        </button>
      </span>
      <span v-if="tags.length === 0" class="none">{{ t("bookmarks.tagsNoneYet") }}</span>
    </div>
    <p v-if="full" class="hint">
      {{ t("bookmarks.tagsFull", { max: MAX_TAGS_PER_BOOKMARK }) }}
    </p>
    <div v-else class="entry">
      <input
        ref="fieldEl"
        v-model="draft"
        class="field"
        type="text"
        :maxlength="TAG_NAME_MAX"
        :placeholder="t('bookmarks.tagPlaceholder')"
        :aria-label="t('bookmarks.tagPlaceholder')"
        autocomplete="off"
        @keyup.enter="submit"
      />
      <button
        type="button"
        class="add"
        :disabled="!canAdd"
        :aria-label="t('bookmarks.tagAdd')"
        :title="t('bookmarks.tagAdd')"
        @click="submit"
      >
        +
      </button>
    </div>
    <ul v-if="choices.length > 0" class="choices">
      <li v-for="name in choices" :key="name">
        <button type="button" class="choice" @click="add(name)">{{ name }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tags-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* What the bookmark wears, read before what it could: a line of chips, each
   carrying the click that takes it back off. */
.worn {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.label {
  flex: none;
  font-size: 13px;
  color: var(--ink-3);
}
.none {
  font-size: 12px;
  color: var(--ink-4);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  padding: 2px 2px 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--ground-2);
  font-size: 12px;
  color: var(--ink-3);
}
.chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-drop {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-pill);
  color: var(--ink-4);
  font-size: 14px;
  line-height: 1;
}
.chip-drop:hover {
  background: var(--paper);
  color: var(--ink);
}
.entry {
  display: flex;
  align-items: center;
  gap: 6px;
}
.field {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  font-size: 13px;
  color: var(--ink);
}
.field:focus {
  outline: none;
  border-color: var(--ink-3);
}
/* What Enter does, for the hand that is on the mouse. */
.add {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  color: var(--ink-3);
  font-size: 16px;
  line-height: 1;
}
.add:hover:not(:disabled) {
  border-color: var(--ink-3);
  color: var(--ink);
}
.add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* The notebook's own words, one click from the entry: the field reads them down
   as it is typed in, and scrolls once there are more than a few, since a
   notebook's vocabulary has no bound a row of chips could hold. */
.choices {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 108px;
  overflow-y: auto;
}
.choice {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--ink-3);
  transition:
    background 160ms ease,
    color 160ms ease;
}
.choice:hover {
  background: var(--ground-2);
  color: var(--ink);
}
.hint {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
</style>
