"use strict";

module.exports = {
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    url: "http://localhost/ztpGroupTimer-dev/",
  },
  testMatch: ["<rootDir>/tests/**/*.test.js"],
};
