import React, { useState } from 'react';
import { api } from '../api/client';

export const Widget = () => {
  load();
  const [n] = useState(0);
  return <div>{n}</div>;
};

function load() {
  api();
}
