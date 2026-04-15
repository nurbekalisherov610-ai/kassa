import { Context, SessionFlavor } from 'grammy';

export type DealStatus = 'pending' | 'confirmed' | 'cancelled';

export interface Deal {
    dealId: string;
    managerName: string;
    managerUsername: string;
    clientName: string;
    numberOfPeople: number;
    departureDate: string;
    returnDate: string;
    contact: string;
    price: number;
    paidAmount: number;
    destination: string;
    contractNumber: string;
    notes: string;
    status: DealStatus;
    timestamp: string;
}

export type WizardStep =
    | 'idle'
    | 'name' | 'people' | 'departure' | 'return'
    | 'phone' | 'price' | 'paid' | 'destination' | 'contract' | 'notes'
    | 'confirm' | 'editField'
    | 'editName' | 'editDeparture' | 'editReturn'
    | 'editPhone' | 'editPrice' | 'editPaid' | 'editDest'
    | 'editContract' | 'editNotes'
    | 'clientSearch'
    | 'debtLookup' | 'debtPayment';

export type AdminStep =
    | 'idle'
    | 'setGoal'
    | 'broadcast'
    | 'customReminder'
    | 'deleteDeal';

export interface SessionData {
    step: WizardStep;
    adminStep: AdminStep;
    tempDeal: Partial<Deal>;
    wizardMessageId?: number;
    debtContractId?: string;  // for debt payment flow
}

export type MyContext = Context & SessionFlavor<SessionData>;
