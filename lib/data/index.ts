import "server-only";
import { cache } from "react";
import { createDemoData, type Data } from "./demo";
import { createNodePgDb } from "./node-pg";
import { createPgData } from "./pg";

/**
 * With DATABASE_URL set the app uses Postgres (Supabase); without it, the in-memory demo store.
 * Every function takes the tenant id explicitly and filters on it: this connection bypasses RLS, so tenant
 * isolation here is enforced in code, with RLS as the second layer for any direct client access.
 */
const g = globalThis as unknown as { __callsdashData?: Promise<Data> };
const backend = (): Promise<Data> =>
  (g.__callsdashData ??= process.env.DATABASE_URL ? Promise.resolve(createPgData(createNodePgDb(process.env.DATABASE_URL))) : createDemoData());

export const usingDatabase = () => Boolean(process.env.DATABASE_URL);

const call = <K extends keyof Data>(k: K) =>
  (async (...a: unknown[]) => ((await backend())[k] as (...x: unknown[]) => unknown)(...a)) as Data[K];

/** Reads are memoized per request, so a layout and its page asking for the same thing hit the database once. */
const read = <K extends keyof Data>(k: K) => cache(call(k)) as Data[K];

export const listTenants = read("listTenants");
export const getTenant = read("getTenant");
export const getProfile = read("getProfile");
export const listProfiles = read("listProfiles");
export const getAgent = read("getAgent");
export const getAgentVersions = read("getAgentVersions");
export const getDoctors = read("getDoctors");
export const getBookings = read("getBookings");
export const getConversations = read("getConversations");
export const getConversation = read("getConversation");
export const getKnowledge = read("getKnowledge");
export const getUnanswered = read("getUnanswered");
export const getAlerts = read("getAlerts");
export const getAudit = read("getAudit");
export const getToolCalls = read("getToolCalls");
export const logToolCall = call("logToolCall");
export const getLedger = read("getLedger");
export const getTopUpRequests = read("getTopUpRequests");
export const getWallet = read("getWallet");
export const getStaffRequests = read("getStaffRequests");
export const listPackages = read("listPackages");
export const usageByChannel = call("usageByChannel");
export const audit = call("audit");
export const recordConversation = call("recordConversation");
export const topUp = call("topUp");
export const requestTopUp = call("requestTopUp");
export const renewTenantPackage = call("renewTenantPackage");
export const saveAgent = call("saveAgent");
export const rollbackAgent = call("rollbackAgent");
export const addKnowledge = call("addKnowledge");
export const deleteKnowledge = call("deleteKnowledge");
export const dismissUnanswered = call("dismissUnanswered");
export const setBookingStatus = call("setBookingStatus");
export const setPermissions = call("setPermissions");
export const updateTenant = call("updateTenant");
export const resolveAlert = call("resolveAlert");
export const createTenant = call("createTenant");
export const addStaffRequest = call("addStaffRequest");
export const setStaffRequestStatus = call("setStaffRequestStatus");
export const setOpeningHours = call("setOpeningHours");
export const setAlertRules = call("setAlertRules");
export const setConversationReviewed = call("setConversationReviewed");
export const addPlan = call("addPlan");
export const endPlan = call("endPlan");
export const savePackage = call("savePackage");
export const archivePackage = call("archivePackage");
export const deleteTenant = call("deleteTenant");
export const marginFor = call("marginFor");
export const creditsOwed = call("creditsOwed");
export const findTenantByAgent = call("findTenantByAgent");
export const createBooking = call("createBooking");
export const updateBooking = call("updateBooking");
export const setBookingMessage = call("setBookingMessage");
export const addAlert = call("addAlert");
export const setDoctorCalendar = call("setDoctorCalendar");
export const addDoctor = call("addDoctor");
export const removeDoctor = call("removeDoctor");
export const updateDoctor = call("updateDoctor");
export const deleteBooking = call("deleteBooking");
export const updateKnowledge = call("updateKnowledge");
export const deleteStaffRequest = call("deleteStaffRequest");
export const deleteConversation = call("deleteConversation");
export const adjustCredits = call("adjustCredits");
export const declineTopUpRequest = call("declineTopUpRequest");
export const deletePackage = call("deletePackage");
export const saveProfile = call("saveProfile");
export const patchProfile = call("patchProfile");
export const removeProfile = call("removeProfile");
export const setOnboarding = call("setOnboarding");
export const setIntegrations = call("setIntegrations");
export const setChannelStatus = call("setChannelStatus");
export const getSecrets = call("getSecrets");
export const setSecrets = call("setSecrets");
export const getSetting = call("getSetting");
export const setSetting = call("setSetting");
export const getChatSession = call("getChatSession");
export const findChatSession = call("findChatSession");
export const saveChatSession = call("saveChatSession");
export const deleteChatSession = call("deleteChatSession");

export const getData = backend;
