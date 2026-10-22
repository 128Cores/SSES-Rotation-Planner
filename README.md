# SSES Rotation Planner

A simple planner for the SSES A–G rotation. View your classes, organize appointments and tasks, and keep recurring activities alongside your school schedule.

**[Open the planner](https://128cores.github.io/SSES-Rotation-Planner/)**

## Features

- **A–G rotation navigation** — Open on today’s date and jump to previous or next occurrences of a rotation day.
- **Class schedules** — View classes, teachers, rooms, and block times.
- **Linked appointments** — Attach appointments and tasks to blocks so they appear directly beneath the class.
- **Weekend planning** — Add tasks and appointments on weekends and days off without displaying classes.
- **Task tracking** — Mark tasks complete and manage them from the schedule or appointment list.
- **Recurring activities** — Configure weekly activities with times, notes, and optional reminders.
- **Daily routines** — View Dinner at 6:00 PM and Sunday Chapel at 6:45 PM. Cancel or restore chapel for an individual Sunday.
- **Reminders** — Choose a reminder time before an appointment or activity, with browser notifications where supported.
- **JSON import and export** — Customize schedules, transfer data, and keep backups.

## Getting Started

1. Open the planner.
2. Under **Planner configuration**, select **Download template**.
3. Edit the JSON template with your blocks, classes, rotation grid, activities, and reference dates.
4. Select **Import** to apply your configuration.
5. Add appointments or tasks and optionally link them to a block.

The default template contains no classes or activities. Its reference dates are examples and should be replaced with your school’s actual rotation dates.

## Rotation Calendar

The planner calculates rotation days using your `referenceCalendar`, skipping weekends and days marked off.

Include at least one **A Day** and one **G Day**. Reference dates must agree with one another. Use `"OFF"` for school holidays or other non-school dates.

You can also mark a date off inside the planner. Classes disappear for that date, while appointments, tasks, activities, and routines remain available.

## Configuration and Planner Data

| Section | What it contains | Import behavior |
| --- | --- | --- |
| **Planner configuration** | Blocks, classes, the A–G grid, recurring activities, and reference dates | Updates the schedule while preserving appointments and tasks |
| **Planner data** | The complete saved planner, including appointments, tasks, configuration, and settings | Restoring replaces the saved planner |

Configuration imports include an **Undo** option. **Reset** clears saved planner data and restores the default template after confirmation.

## Data Storage

Your data is saved in your browser’s **localStorage**. The app does not upload imported schedules or appointments to GitHub.

Each browser, browser profile, and device has separate storage. There are no accounts or automatic synchronization.

To transfer your planner:

1. Select **Planner data → Export** in the original browser.
2. Open the planner in the destination browser.
3. Select **Planner data → Restore** and choose the exported JSON file.

Clearing browser data or using Reset removes saved records. Keep an exported backup of anything you want to preserve.

## Notifications

Notifications require browser support and permission. A start time must be set before enabling an appointment reminder.

Keep the planner open for reminders to run. Closing the tab stops reminders, and device sleep or suspended tabs may delay them. Times follow your device’s local timezone.

## Running Locally

Download the repository and open `index.html` in your browser. Keep these files together:

```text
index.html     Page structure
styles.css     Appearance and layout
app.js         Planner functionality
favicon.svg    Browser tab icon
```

No installation, API key, or build step is required.

## Credits

Created by **MemoryLaine**.

**Version 1.0.0**

## License

This project is licensed under the [MIT License](LICENSE).

You may use, modify, and distribute the project as long as the original copyright and license notice are included.
