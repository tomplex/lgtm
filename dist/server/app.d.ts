import express from 'express';
import { type Session } from './session.js';
import { type SessionManager } from './session-manager.js';
declare global {
    namespace Express {
        interface Locals {
            session: Session;
        }
    }
}
export declare function createApp(manager: SessionManager): express.Express;
