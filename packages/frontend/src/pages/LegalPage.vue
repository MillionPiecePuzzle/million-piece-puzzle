<script setup lang="ts">
import LegalDocument from "../components/LegalDocument.vue";
</script>

<template>
  <LegalDocument title="Legal Notice" updated="June 7, 2026">
    <h2>Publisher</h2>
    <p>This site is published by a private individual. Contact: Discord @krantt.</p>

    <h2>Host</h2>
    <p>
      The frontend is hosted by Cloudflare, Inc. (101 Townsend Street, San Francisco, CA 94107, USA)
      on Cloudflare Pages. The game backend is hosted on a server provided by Hetzner Online GmbH
      (Industriestr. 25, 91710 Gunzenhausen, Germany).
    </p>

    <h2>Nature of the project</h2>
    <p>
      Million Piece Puzzle is a non-commercial project. It generates no revenue, contains no
      advertising and offers no paid content.
    </p>

    <h2>Intellectual property</h2>
    <p>
      Million Piece Puzzle is open source. The source code is published under the MIT license and
      available on the
      <a
        href="https://github.com/MillionPiecePuzzle/million-piece-puzzle"
        target="_blank"
        rel="noopener"
      >
        project repository</a
      >. The puzzle artwork and other visuals belong to their respective authors and are credited
      where applicable. The project uses no AI-generated content.
    </p>

    <h2>Liability</h2>
    <p>
      Million Piece Puzzle is provided "as is", without any warranty. The publisher cannot be held
      responsible for service interruptions, data loss or any damage resulting from use of the site.
    </p>
  </LegalDocument>
</template>
