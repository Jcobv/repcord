# RepCord

> **Did you train today? Color in the square.**

A gym log with a heatmap calendar. Pick the split you trained, say how hard it was, and the day lights up on your calendar. Skip a few days and you'll see the gap.

|   |   |
|---|---|
| **Student** | Ron Jacob Perez |
| **Course** | Integrative Programming Technologies |
| **Project** | Individual Final Project: Website Development |
| **School** | National University, College of Computing and Information Technologies |
| **Website Category** | Fitness / Health Tracker |

---

## Project Description

RepCord is a single-page web application for tracking gym workouts. Users create an account, build their own workout splits (like Push Day or Leg Day) from an exercise library, and log each session on a GitHub-style heatmap calendar. Harder days show up as brighter squares, so consistency is visible at a glance.

Each user's data is saved to their own account in the cloud, so their workouts, splits and lifts follow them to any device.

## Main Features

### Accounts
- Sign up and log in with an email and password (Firebase Authentication)
- Username validation (3 to 20 characters; letters, numbers, spaces and underscores)
- Password rules (7+ characters with a capital letter, a number and a special character)
- Show/hide password toggle, with readable error messages for failed logins
- Stays logged in between visits; edit your username from the profile page

### Heatmap Calendar
- A full-year calendar where each day is a square
- Click any day to log, edit or delete a workout
- Choose a split and an intensity: **Light**, **Moderate** or **Failure**
- Harder days get brighter squares
- Streak tracking: current streak, longest streak, workouts this month and total workouts

### Splits
- Create, edit and delete your own splits
- Exercise library grouped by muscle group, with search and muscle filters
- Add your own custom exercises if one isn't in the list

### Lifts and Progress
- Update weight and reps for all the exercises in a split at once
- Each exercise keeps your latest and heaviest numbers
- Works in **kg or lb**, with automatic conversion if you switch units
- Progress chart for every exercise

### History
- Searchable workout history
- Filter by intensity (All / Light / Moderate / Failure)
- Delete workouts with a confirmation dialog

### Home and Profile
- Home dashboard with a greeting, today's status, quick stats, a this-week strip, recent workouts and top lifts
- Profile page with account info, intensity breakdown and most-trained splits

### About / User Guide
- A separate About page that visitors can read before signing up
- Explains how the system works in plain words, with visuals: a 4-step overview, a practice calendar you can click, an example split, an example progress chart and example streak numbers
- Lists everything a user can do, plus a short FAQ

### Customization and Usability
- Theme picker with four presets (Default, Dark, Ocean, Sunset) plus a custom color wheel
- Font picker
- Responsive layout for desktop, tablet and mobile
- Toast notifications and styled confirmation dialogs

## Pages / Sections

1. **Landing page**: overview of the app with a sample heatmap
2. **About**: user guide explaining how the system works and how to use it
3. **Login / Register**
4. **Home**: dashboard
5. **Your Calendar**: heatmap and workout logging
6. **Workouts**: History, Progress and Splits tabs
7. **My Profile**

## Technologies Used

| Area | Technology |
|---|---|
| Structure | HTML5 |
| Styling | CSS3 (custom properties for theming, responsive media queries) |
| Logic | JavaScript (ES modules) |
| Authentication | Firebase Authentication |
| Database | Cloud Firestore |
| Fonts | Google Fonts (Barlow, Barlow Condensed) |
| Browser storage | `localStorage` (saved theme and login hint) |

No build tools or frameworks are required.

## Database Structure

Each user's data lives under their own account in Cloud Firestore:

```
users/{uid}/
  ├── logs/{YYYY-MM-DD}   → workout, intensity, split, exercises for that day
  ├── exercises/{id}      → name, latest, max, reps, unit, history[]
  └── folders/{id}        → split name and its exercises
```

## Project Structure

```
repcord/
├── index.html     # all pages and sections
├── style.css      # styling and responsive layout
├── script.js      # app logic (calendar, splits, progress, auth, profile)
├── theme.js       # theme and font picker
├── firebase.js    # Firebase configuration
├── favicon.svg
└── README.md
```

## How to Run

The app uses JavaScript modules, so it must be served over HTTP. Opening `index.html` directly from the file system will not work.

1. Clone the repository
   ```bash
   git clone https://github.com/Jcobv/repcord.git
   cd repcord
   ```
2. Start a local server, for example:
   - **VS Code:** right-click `index.html` and choose *Open with Live Server*, or
   - **Python:** `python -m http.server 8000`, then open `http://localhost:8000`
3. Create an account and start logging workouts.

### Using your own Firebase project (optional)

1. Create a project at the [Firebase Console](https://console.firebase.google.com/)
2. Enable **Authentication** (Email/Password) and **Cloud Firestore**
3. Replace the values in `firebase.js` with your project's web app config
4. Set Firestore rules so users can only access their own data:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

## Screenshots

> Add a screenshot of each page here once taken, for example:
>
> ```markdown
> ### Landing Page
> ![Landing page](screenshots/landing.png)
> ```

## Author

**Ron Jacob Perez**
Made for the Integrative Programming Technologies final project, 2026.
