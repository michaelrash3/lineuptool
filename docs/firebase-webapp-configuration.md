# LineupGenerator Web App Configuration Guide

This document outlines the essential configuration details for the LineupGenerator web application, focusing on Firebase and Google Cloud settings to ensure smooth operation, especially for user authentication.

## 1. Project Overview

- **Project ID:** `lineupgenerator-79159`
- **Project Display Name:** `LineupGenerator`
- **Web App Framework:** Web app (TypeScript/JavaScript)
- **Firebase Billing Plan:** Spark (no-cost)

## 2. Firebase Authentication Configuration

**Purpose:** Manages user sign-up and sign-in for the application.

### Default Provider: Google Sign-In

- **Enabled:** Yes
- **Client ID:** `533055070205-lblrt6i9pc1l515lck3j5m7j17a89ui1.apps.googleusercontent.com` (configured in Firebase Authentication settings)

### Authorized Domains

These domains are explicitly allowed by Firebase Authentication to host the app and perform authentication operations.

- `localhost`
- `lineupgenerator-79159.firebaseapp.com`
- `lineupgenerator-79159.web.app`
- `8fj9yr.csb.app`
- `7yzljs.csb.app`
- `87bdc616-1bb5-40fa-b31c-a19bf9294d5c-00-3r9gh6jf31way.kirk.replit.dev`
- `NKB-Lineup-Generator.replit.app`
- `842c1790.preview.workshop.ai`
- `87bdc616-1bb5-40fa-b31c-a19bf9294d5c-00-3r9gh6jf31way-r1og9s5n.kirk.replit.dev`
- `87bdc616-1bb5-40fa-b31c-a19bf9294d5c-00-3r9gh6jf31way-ryxg6dju.kirk.replit.dev`
- `lineuptool-fbd6x7k3u-michaelrash3s-projects.vercel.app`
- `lineuptool.vercel.app`
- `lineuptool-4c3d5dwih-michaelrash3s-projects.vercel.app`
- `lineuptool-git-codex-locate-errors-michaelrash3s-projects.vercel.app`
- `lineuptool-git-codex-review-imple-f4a5d6-michaelrash3s-projects.vercel.app`
- `lineuptool-r5aomeysi-michaelrash3s-projects.vercel.app`
- `lineuptool-git-codex-add-onboardi-aef5bc-michaelrash3s-projects.vercel.app`

Manage these in **Firebase Console → Authentication → Settings → Authorized domains**.

## 3. Google Cloud Console OAuth 2.0 Client ID Configuration

**Purpose:** This governs the Google Sign-In flow and redirects users back to the app. It is separate from Firebase authorized domains but equally critical.

### Key Item to Verify: Authorized Redirect URIs

Use redirect URIs that match the app's configured Firebase `authDomain`.

In this repo's current runtime configuration, `authDomain` resolves to Firebase Hosting (`lineupgenerator-79159.firebaseapp.com`) unless an injected config explicitly sets another value.

Primary redirect URI:

- `https://lineupgenerator-79159.firebaseapp.com/__/auth/handler`

Optional additional redirect URI (if you set/inject authDomain to web.app):

- `https://lineupgenerator-79159.web.app/__/auth/handler`

> Do **not** switch OAuth redirect URIs to Vercel/Replit/CSB app hosts unless those hosts also proxy or serve `/__/auth/*` for Firebase Auth helper endpoints.

Manage these in **Google Cloud Console → APIs & Services → Credentials → Web client OAuth 2.0 Client ID**.

## 4. Firestore Configuration

**Purpose:** Defines data storage and access rules.

- **Database:** `(default)`
- **Location:** `nam5`
- **Database Type:** `FIRESTORE_NATIVE`

### Firestore Security Rules

Current rules are designed to manage user settings and team data so only authenticated users and team members can access relevant information. Key functions include `isSignedIn()`, `membersList(data)`, and `isMember(data)`.

View/edit rules in **Firebase Console → Firestore Database → Rules**.

## 5. Troubleshooting Authentication Issues

If new users hit an infinite Google Sign-In loop or cannot log in:

1. Check Google Cloud Console authorized redirect URIs. Ensure the URI for the configured `authDomain` exists (typically `https://lineupgenerator-79159.firebaseapp.com/__/auth/handler`).
2. Verify Firebase authorized domains include all deployment domains where the app is served.
3. Open browser developer tools and inspect console errors during sign-in.
4. Verify `firebaseConfig.authDomain` is set to a domain that actually serves Firebase Auth helper endpoints (`/__/auth/*`).
