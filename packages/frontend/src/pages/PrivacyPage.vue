<script setup lang="ts">
import LegalDocument from "../components/LegalDocument.vue";
</script>

<template>
  <LegalDocument title="Privacy Policy" updated="June 7, 2026">
    <p>
      Million Piece Puzzle is a personal, non-commercial project run by an independent developer.
      This page explains what data is collected, why, and how to exercise your rights.
    </p>

    <h2>Data controller</h2>
    <p>
      The service is operated by an independent developer (contact: Discord @krantt). No legal
      entity is declared for this project at this time.
    </p>

    <h2>Data collected</h2>
    <p>
      Spectators browse the canvas anonymously and no account is created for them. When you sign in
      to contribute, the following are stored: a unique user identifier, the pseudo you choose, and
      the country you select during onboarding. Because sign-in uses Google, your email address,
      your name and your avatar from Google are also stored. Your contributions (which pieces you
      placed and when) are recorded and shown publicly for snap attribution and the leaderboard.
      Technical logs (IP address, browser) are processed by the host for security and reliability,
      including rate limiting.
    </p>

    <h2>Purposes</h2>
    <p>
      Data is used only to run the game: to authenticate you, save your progress, attribute placed
      pieces, and display the leaderboard. No data is sold or used for advertising.
    </p>

    <h2>Sub-processors</h2>
    <p>
      The service relies on Google (sign-in), Cloudflare (frontend hosting, asset storage and
      delivery, and cookieless, privacy-friendly web analytics) and Hetzner (the server hosting the
      game backend). These providers may process data outside the European Union under their own
      protection frameworks. No other third-party tracking or analytics service is used, and error
      monitoring is self-hosted.
    </p>

    <h2>Retention</h2>
    <p>
      Your data is kept for as long as your account exists. You can request its deletion at any time
      using the contact below.
    </p>

    <h2>Your rights</h2>
    <p>
      Under the GDPR you have a right of access, rectification, erasure and portability of your
      data, as well as a right to object. To exercise them, contact the developer on Discord
      (@krantt). Requests are handled within a reasonable time.
    </p>

    <h2>Cookies</h2>
    <p>
      The site only uses the cookies and local storage necessary for sign-in and for your
      preferences. No advertising or audience-measurement cookies are set; the web analytics used is
      cookieless.
    </p>
  </LegalDocument>
</template>
