declare global {
  interface Window {
    electronApi: {
      sigma: (fac: number) => Promise<number>
    }
  }
}

export {}
