#!/usr/bin/env bash
# GYM-287 — 🔴 PREUVE QUE L'AASA ET LES CHEMINS QU'ELLE DÉCLARE N'ONT PAS BOUGÉ.
#
# ═══════════════════════════════════════════════════════════════════════════════════════
# POURQUOI CE SCRIPT EXISTE
# ═══════════════════════════════════════════════════════════════════════════════════════
# Ce lot ajoute des `rewrites` à `apps/links`. Un rewrite trop large intercepterait
# /.well-known/apple-app-site-association — et le jour où iOS ne peut plus lire ce fichier,
# les Universal Links de Dopamine cessent de fonctionner SANS AUCUNE ERREUR : les liens
# s'ouvrent simplement dans le navigateur, chez le client, et rien ne le signale ici.
#
# ⚠️ CE N'EST PAS UN TEST UNITAIRE, C'EST UNE VÉRIFICATION DE PRODUCTION. Vercel déploie au
# merge : ce script se joue AVANT (pour figer la référence) et APRÈS (pour prouver
# l'égalité). Les deux sorties doivent être identiques ligne pour ligne.
#
# USAGE :  bash apps/links/scripts-verif-aasa.sh  [base]
#          base par défaut : https://links.viniz.app
set -uo pipefail
BASE="${1:-https://links.viniz.app}"

echo "── AASA elle-même ────────────────────────────────────────────────────────────────"
printf '%-58s ' "$BASE/.well-known/apple-app-site-association"
code=$(curl -s -o /tmp/aasa.json -w '%{http_code}' "$BASE/.well-known/apple-app-site-association")
ctype=$(curl -s -o /dev/null -w '%{content_type}' "$BASE/.well-known/apple-app-site-association")
echo "$code  $ctype  sha256=$(shasum -a 256 /tmp/aasa.json | cut -c1-16)"

echo
echo "── Les chemins que l'AASA DÉCLARE (doivent répondre comme avant) ─────────────────"
# /dopamine/* : revendiqué par l'app be.dopamineclub.app. Ces pages EXISTENT en statique et
# doivent continuer d'être servies par le FICHIER, jamais par un rewrite.
for p in /dopamine/reset-password /dopamine/bookings /dopamine/confirm-waitlist \
         /dopamine/delete-account /dopamine/payment-success; do
  printf '%-58s ' "$p"
  curl -s -o /tmp/p.html -w '%{http_code}' "$BASE$p"
  echo "  $(grep -c 'DOPAMINE' /tmp/p.html) occurrence(s) « DOPAMINE »  $(wc -c </tmp/p.html | tr -d ' ') octets"
done

echo
echo "── Les chemins d'une AUTRE salle (c'est eux que ce lot change) ───────────────────"
for p in /studio-yoga-test-1/reset-password /studio-yoga-test-1/bookings \
         /studio-yoga-test-1/payment-success /studio-yoga-test-1/inconnu; do
  printf '%-58s ' "$p"
  curl -s -o /tmp/q.html -w '%{http_code}' "$BASE$p"
  echo "  $(wc -c </tmp/q.html | tr -d ' ') octets"
done
