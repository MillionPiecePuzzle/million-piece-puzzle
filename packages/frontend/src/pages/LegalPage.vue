<script setup lang="ts">
import { useI18n } from "vue-i18n";
import LegalDocument from "../components/LegalDocument.vue";

const { t } = useI18n();
const UPDATED_AT = Date.UTC(2026, 5, 7);
const DISCORD_URL = "https://discord.gg/VhtfHqTfS";
const REPO_URL = "https://github.com/MillionPiecePuzzle/million-piece-puzzle";
</script>

<template>
  <LegalDocument :title="t('legalPage.title')" :updated-at="UPDATED_AT">
    <h2>{{ t("legalPage.publisherHead") }}</h2>
    <i18n-t keypath="legalPage.publisherBody" tag="p" scope="global">
      <template #discord>
        <a :href="DISCORD_URL" target="_blank" rel="noopener">{{ t("legalPage.discord") }}</a>
      </template>
    </i18n-t>

    <h2>{{ t("legalPage.hostHead") }}</h2>
    <p>{{ t("legalPage.hostBody") }}</p>

    <h2>{{ t("legalPage.natureHead") }}</h2>
    <p>{{ t("legalPage.natureBody") }}</p>

    <h2>{{ t("legalPage.ipHead") }}</h2>
    <i18n-t keypath="legalPage.ipBody" tag="p" scope="global">
      <template #repo>
        <a :href="REPO_URL" target="_blank" rel="noopener">{{ t("legalPage.repo") }}</a>
      </template>
    </i18n-t>

    <h2>{{ t("legalPage.liabilityHead") }}</h2>
    <p>{{ t("legalPage.liabilityBody") }}</p>

    <h2>{{ t("legalPage.licensesHead") }}</h2>
    <i18n-t keypath="legalPage.licensesBody" tag="p" scope="global">
      <template #sourceRepo>
        <a :href="REPO_URL" target="_blank" rel="noopener">{{ t("legalPage.sourceRepo") }}</a>
      </template>
    </i18n-t>
  </LegalDocument>
</template>
