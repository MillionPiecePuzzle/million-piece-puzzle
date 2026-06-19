<script setup lang="ts">
import { useI18n } from "vue-i18n";
import LegalDocument from "../components/LegalDocument.vue";

const { t } = useI18n();
const UPDATED_AT = Date.UTC(2026, 5, 7);
const DISCORD_URL = "https://discord.gg/VhtfHqTfS";
</script>

<template>
  <LegalDocument :title="t('privacyPage.title')" :updated-at="UPDATED_AT">
    <p>{{ t("privacyPage.intro") }}</p>

    <h2>{{ t("privacyPage.controllerHead") }}</h2>
    <i18n-t keypath="privacyPage.controllerBody" tag="p" scope="global">
      <template #discord>
        <a :href="DISCORD_URL" target="_blank" rel="noopener">{{ t("privacyPage.discord") }}</a>
      </template>
    </i18n-t>

    <h2>{{ t("privacyPage.collectedHead") }}</h2>
    <p>{{ t("privacyPage.collectedBody") }}</p>

    <h2>{{ t("privacyPage.purposesHead") }}</h2>
    <p>{{ t("privacyPage.purposesBody") }}</p>

    <h2>{{ t("privacyPage.processorsHead") }}</h2>
    <p>{{ t("privacyPage.processorsBody") }}</p>

    <h2>{{ t("privacyPage.retentionHead") }}</h2>
    <p>{{ t("privacyPage.retentionBody") }}</p>

    <h2>{{ t("privacyPage.cookiesHead") }}</h2>
    <p>{{ t("privacyPage.cookiesBody") }}</p>
  </LegalDocument>
</template>
