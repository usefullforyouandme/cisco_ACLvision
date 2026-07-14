import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { Device } from '../types/ir';

export type ViewId = 'summary' | 'acl' | 'map' | 'review' | 'raw';

export interface AppState {
  devices: Device[];
  activeDeviceId: string | null;
  activeView: ViewId;
  /** 原文ビューへジャンプする際のハイライト対象行(1 始まり)。 */
  highlightLineNo: number | null;
}

export type Action =
  | { type: 'LOAD'; devices: Device[] }
  | { type: 'CLEAR_ALL' }
  | { type: 'SET_ACTIVE_DEVICE'; id: string }
  | { type: 'SET_VIEW'; view: ViewId }
  | { type: 'JUMP_TO_LINE'; lineNo: number };

const initialState: AppState = {
  devices: [],
  activeDeviceId: null,
  activeView: 'summary',
  highlightLineNo: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD': {
      const devices = [...state.devices, ...action.devices];
      return {
        ...state,
        devices,
        activeDeviceId: state.activeDeviceId ?? action.devices[0]?.id ?? null,
      };
    }
    case 'CLEAR_ALL':
      // データ消去: メモリ上の読込データを完全に破棄する(基本設計 §4.1 / §8.1)。
      return { ...initialState };
    case 'SET_ACTIVE_DEVICE':
      return { ...state, activeDeviceId: action.id, highlightLineNo: null };
    case 'SET_VIEW':
      return { ...state, activeView: action.view };
    case 'JUMP_TO_LINE':
      return { ...state, activeView: 'raw', highlightLineNo: action.lineNo };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
  activeDevice: Device | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeDevice = useMemo(
    () => state.devices.find((d) => d.id === state.activeDeviceId) ?? null,
    [state.devices, state.activeDeviceId],
  );
  const value = useMemo(
    () => ({ state, dispatch, activeDevice }),
    [state, activeDevice],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
