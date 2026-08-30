import { Component } from '@angular/core';
import { HeroVisualComponent } from '../hero-visual/hero-visual.component';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [HeroVisualComponent],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css'
})
export class HeroComponent {}