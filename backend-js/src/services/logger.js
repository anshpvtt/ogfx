import winston from "winston";
import fs from "node:fs";

const { combine, timestamp, printf, colorize, json } = winston.format;

const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let meta = "";
  if (Object.keys(metadata).length > 0) {
    meta = JSON.stringify(metadata, null, 2);
  }
  return `${timestamp} [${level}]: ${message} ${meta}`;
});

const transports = [
  new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      consoleFormat
    ),
  }),
];

if (process.env.NODE_ENV !== "production" || process.env.ENABLE_FILE_LOGS === "true") {
  fs.mkdirSync("logs", { recursive: true });
  transports.push(
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      format: combine(timestamp(), json()),
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
      format: combine(timestamp(), json()),
    })
  );
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: { service: "ogfx-backend" },
  transports,
});
