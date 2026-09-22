import './app.css';
import { mount } from 'svelte';
import NotFound from './lib/NotFound.svelte';

mount(NotFound, { target: document.getElementById('app')! });
