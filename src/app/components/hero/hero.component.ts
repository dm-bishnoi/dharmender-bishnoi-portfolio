import { Component } from '@angular/core';
import { DottedTextComponent } from '../dotted-text/dotted-text.component';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [DottedTextComponent],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css'
})
export class HeroComponent {}
